#!/usr/bin/env node
/*
 * Servidor de producción de Murmur. Sin dependencias: solo Node (≥ 22.12).
 *
 *  - Sirve la compilación de `dist/` (comprimida en memoria, con caché larga para los archivos con hash).
 *  - Reenvía /api y /health al backend añadiendo la cabecera X-Api-Key. La clave sale de una variable de entorno y nunca
 *    llega al navegador. Las subidas (hasta 2 GB) y el progreso en directo (Server-Sent Events) pasan en streaming.
 *  - Añade cabeceras de seguridad (CSP con el hash del script en línea, permisos de micrófono, sin marcos…).
 *  - /healthz (el proceso responde) y /readyz (además, el backend responde) para el orquestador.
 *
 * Toda la configuración va en variables de entorno; ver .env.production.example y docs/DESPLIEGUE.md.
 *   pnpm build && pnpm start
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { Agent as HttpAgent, createServer, request as httpRequest } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants as zlib, gzipSync } from 'node:zlib';

// ── Configuración ─────────────────────────────────────────────────────────────

const env = process.env;
const flag = (value) => /^(1|true|yes|on)$/i.test(value ?? '');

const config = {
  appEnv: env.APP_ENV || 'production',
  host: env.HOST || '0.0.0.0',
  port: Number(env.PORT || 8080),
  backendUrl: env.BACKEND_URL ?? '',
  apiKey: env.BACKEND_API_KEY ?? '',
  /** Solo para backends internos con certificado propio. Nunca contra un servidor público. */
  allowSelfSigned: flag(env.BACKEND_ALLOW_SELF_SIGNED),
  maxUploadBytes: Number(env.MAX_UPLOAD_MB || 2000) * 1024 * 1024,
  basicAuthUser: env.BASIC_AUTH_USER ?? '',
  basicAuthPassword: env.BASIC_AUTH_PASSWORD ?? '',
  hstsSeconds: Number(env.HSTS_MAX_AGE || 0),
  logRequests: env.LOG_REQUESTS == null ? true : flag(env.LOG_REQUESTS),
  staticDir: resolve(fileURLToPath(new URL('.', import.meta.url)), env.STATIC_DIR || '../dist'),
};

const DEV_KEY = 'meeting-transcriber-local-development-key';

function validate() {
  const errors = [];
  let backend = null;
  try {
    backend = new URL(config.backendUrl);
    if (!/^https?:$/.test(backend.protocol)) errors.push('BACKEND_URL tiene que empezar por http:// o https://');
  } catch {
    errors.push('BACKEND_URL es obligatoria (por ejemplo https://api.interna:52610)');
  }
  if (!config.apiKey) errors.push('BACKEND_API_KEY es obligatoria');
  if (config.appEnv === 'production' && config.apiKey === DEV_KEY) errors.push('BACKEND_API_KEY no puede ser la clave pública de desarrollo en producción');
  if (Boolean(config.basicAuthUser) !== Boolean(config.basicAuthPassword)) errors.push('BASIC_AUTH_USER y BASIC_AUTH_PASSWORD van juntas');
  if (!Number.isInteger(config.port) || config.port <= 0) errors.push('PORT no es válido');
  if (errors.length > 0) {
    for (const error of errors) console.error(`✗ ${error}`);
    console.error('Revisa las variables de entorno (ver .env.production.example).');
    process.exit(1);
  }
  if (backend.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(backend.hostname) && !/^(10|172\.(1[6-9]|2\d|3[01])|192\.168)\./.test(backend.hostname)) {
    console.warn(`! BACKEND_URL usa http:// con ${backend.hostname}: la clave viaja sin cifrar. Usa https:// si el backend no está en la misma red privada.`);
  }
  if (config.appEnv === 'production' && !config.basicAuthUser) {
    console.warn('! Sin BASIC_AUTH_USER: cualquiera que llegue a esta web puede usar la API con la clave del servidor. Protégela (aquí o en el proxy de delante).');
  }
  return backend;
}

const backend = validate();
const backendRequest = backend.protocol === 'https:' ? httpsRequest : httpRequest;
const backendAgent =
  backend.protocol === 'https:'
    ? new HttpsAgent({ keepAlive: true, rejectUnauthorized: !config.allowSelfSigned })
    : new HttpAgent({ keepAlive: true });
/** Ruta base del backend, por si está publicado bajo un prefijo (https://host/transcriber) */
const backendBase = backend.pathname.replace(/\/$/, '');

// ── Archivos estáticos (en memoria, ya comprimidos) ───────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt', '.webmanifest']);

/** @type {Map<string, { type: string; raw: Buffer; gzip?: Buffer; br?: Buffer; etag: string; cache: string }>} */
const files = new Map();
let scriptHashes = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)])));
  return nested.flat();
}

async function loadStatic() {
  let paths;
  try {
    paths = await walk(config.staticDir);
  } catch {
    console.error(`✗ No existe ${config.staticDir}. Compila antes con «pnpm build».`);
    process.exit(1);
  }
  for (const path of paths) {
    const url = `/${relative(config.staticDir, path).split(sep).join('/')}`;
    const ext = extname(path).toLowerCase();
    let raw = await readFile(path);
    if (url === '/index.html') {
      // El entorno se indica en tiempo de ejecución: la misma compilación sirve para preproducción y producción
      raw = Buffer.from(raw.toString('utf8').replace(/(<meta name="app-environment" content=")[^"]*(")/, `$1${escapeHtml(config.appEnv)}$2`));
      scriptHashes = [...raw.toString('utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(([, code]) => `'sha256-${createHash('sha256').update(code).digest('base64')}'`);
    }
    const file = {
      type: MIME[ext] ?? 'application/octet-stream',
      raw,
      etag: `"${createHash('sha1').update(raw).digest('base64url')}"`,
      // Los archivos de /assets llevan hash en el nombre: no cambian nunca. index.html se revalida siempre.
      cache: url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : url === '/index.html' ? 'no-cache' : 'public, max-age=3600',
    };
    if (COMPRESSIBLE.has(ext) && raw.length > 1024) {
      file.gzip = gzipSync(raw, { level: 9 });
      file.br = brotliCompressSync(raw, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11 } });
    }
    files.set(url, file);
  }
  if (!files.has('/index.html')) {
    console.error(`✗ ${config.staticDir} no tiene index.html. Compila antes con «pnpm build».`);
    process.exit(1);
  }
}

const escapeHtml = (text) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

// ── Cabeceras de seguridad ────────────────────────────────────────────────────

function securityHeaders() {
  const csp = [
    "default-src 'self'",
    `script-src 'self' ${scriptHashes.join(' ')}`.trim(),
    // React aplica estilos en línea (style="…"): hace falta 'unsafe-inline' solo para estilos
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  const headers = {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    // Micrófono, captura de pestaña o pantalla y pantalla encendida: solo esta web. El resto, para nadie.
    'Permissions-Policy': 'microphone=(self), display-capture=(self), screen-wake-lock=(self), camera=(), geolocation=(), payment=(), usb=()',
  };
  if (config.hstsSeconds > 0) headers['Strict-Transport-Security'] = `max-age=${config.hstsSeconds}; includeSubDomains`;
  return headers;
}

let SECURITY = {};

// ── Proxy hacia el backend ────────────────────────────────────────────────────

/** Cabeceras que no se reenvían: de salto (RFC 9110), credenciales del navegador y la clave, que solo pone este servidor */
const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host']);
const STRIP_REQUEST = new Set([...HOP, 'x-api-key', 'authorization', 'cookie']);

/** Conexiones de progreso en directo abiertas, para cerrarlas al apagar */
const streams = new Set();

function proxy(req, res) {
  const length = Number(req.headers['content-length'] ?? 0);
  if (length > config.maxUploadBytes) return problem(res, 413, 'UploadTooLarge');

  const target = new URL(`${backendBase}${req.url}`, backend.origin);
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) if (!STRIP_REQUEST.has(name)) headers[name] = value;
  headers['x-api-key'] = config.apiKey;
  headers['x-forwarded-for'] = [req.headers['x-forwarded-for'], req.socket.remoteAddress].filter(Boolean).join(', ');
  headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] ?? (req.socket.encrypted ? 'https' : 'http');
  headers['x-forwarded-host'] = req.headers.host ?? '';

  const upstream = backendRequest(target, { method: req.method, headers, agent: backendAgent }, (answer) => {
    const out = {};
    for (const [name, value] of Object.entries(answer.headers)) if (!HOP.has(name)) out[name] = value;
    const sse = String(answer.headers['content-type'] ?? '').startsWith('text/event-stream');
    if (sse) {
      out['cache-control'] = 'no-store';
      out['x-accel-buffering'] = 'no';
      streams.add(res);
      res.on('close', () => streams.delete(res));
    }
    res.writeHead(answer.statusCode ?? 502, out);
    if (sse) res.flushHeaders();
    answer.pipe(res);
  });

  upstream.on('error', (error) => {
    if (!res.headersSent) problem(res, 502, 'BackendUnavailable');
    else res.destroy();
    if (config.logRequests) console.warn(`! backend: ${error.code ?? error.message}`);
  });
  // Si el navegador corta (cancela una subida o cierra la pestaña), se corta también la petición al backend
  res.on('close', () => {
    if (!res.writableFinished) upstream.destroy();
  });
  req.pipe(upstream);
}

function problem(res, status, code) {
  res.writeHead(status, { 'Content-Type': 'application/problem+json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ status, title: 'Solicitud no atendida', code }));
}

// ── Autenticación básica opcional ─────────────────────────────────────────────

const expectedAuth = config.basicAuthUser ? Buffer.from(`Basic ${Buffer.from(`${config.basicAuthUser}:${config.basicAuthPassword}`).toString('base64')}`) : null;

function authorized(req) {
  if (!expectedAuth) return true;
  const given = Buffer.from(req.headers.authorization ?? '');
  return given.length === expectedAuth.length && timingSafeEqual(given, expectedAuth);
}

// ── Servidor ──────────────────────────────────────────────────────────────────

function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400);
    return res.end();
  }
  // Las rutas de la app van con # (/#/biblioteca), así que solo hay que servir index.html en / y en lo que no sea un archivo
  const file = files.get(path) ?? (extname(path) ? null : files.get('/index.html'));
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY });
    return res.end('No encontrado');
  }
  const headers = { 'Content-Type': file.type, 'Cache-Control': file.cache, ETag: file.etag, Vary: 'Accept-Encoding', ...SECURITY };
  if (req.headers['if-none-match'] === file.etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  const accept = String(req.headers['accept-encoding'] ?? '');
  let body = file.raw;
  if (file.br && /\bbr\b/.test(accept)) {
    body = file.br;
    headers['Content-Encoding'] = 'br';
  } else if (file.gzip && /\bgzip\b/.test(accept)) {
    body = file.gzip;
    headers['Content-Encoding'] = 'gzip';
  }
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

async function ready(res) {
  const ok = await new Promise((done) => {
    const check = backendRequest(new URL(`${backendBase}/health`, backend.origin), { agent: backendAgent, timeout: 3000 }, (answer) => {
      answer.resume();
      done(answer.statusCode === 200);
    });
    check.on('timeout', () => check.destroy());
    check.on('error', () => done(false));
    check.end();
  });
  res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ status: ok ? 'ready' : 'backend-unavailable' }));
}

const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;

await loadStatic();
SECURITY = securityHeaders();

const server = createServer((req, res) => {
  const started = Date.now();
  const path = (req.url ?? '/').split('?')[0];
  if (config.logRequests && path !== '/healthz' && path !== '/readyz') {
    // Solo método, ruta y estado: la query lleva nombres de archivo, que no deben quedar en los registros
    res.on('finish', () => console.log(`${req.method} ${path} ${res.statusCode} ${Date.now() - started}ms`));
  }

  if (path === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ status: 'ok', environment: config.appEnv, version }));
  }
  if (path === '/readyz') return void ready(res);

  if (!authorized(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Murmur", charset="UTF-8"', 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Autenticación necesaria');
  }
  if (path === '/health' || path.startsWith('/api/')) return proxy(req, res);
  return serveStatic(req, res);
});

// Subidas de gigas y progreso en directo: sin límite de duración por petición, pero sí para recibir las cabeceras
server.requestTimeout = 0;
server.headersTimeout = 60_000;
server.keepAliveTimeout = 65_000;

server.listen(config.port, config.host, () => {
  console.log(`Murmur ${version} · ${config.appEnv} · http://${config.host}:${config.port} → ${backend.origin}${backendBase}`);
});

// Apagado ordenado: deja de aceptar conexiones, avisa a los flujos en directo (el navegador reconecta solo) y sale
let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: cerrando…`);
  for (const stream of streams) stream.end();
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
