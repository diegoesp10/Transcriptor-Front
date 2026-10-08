import type {
  ConfirmExportDto,
  ErrorDto,
  LocalArtifactDto,
  LocalExportDto,
  MeetingProgressDto,
  MeetingStatusDto,
  ProblemDetailsDto,
  RetryDto,
  SummaryResponseDto,
  TranscriptDto,
  TranscriptionConfigDto,
} from './types';

/**
 * Cliente de la API. Todas las rutas son relativas: en desarrollo las atiende el proxy de Vite, que añade X-Api-Key y
 * evita CORS (ver vite.config.ts). No hay datos simulados: todo sale de la API.
 *
 * El backend limita las peticiones por IP (60 lecturas/min por endpoint, 120/min en total, 30 cada 10 s) y bloquea
 * temporalmente la IP si se repiten los excesos. Por eso, ante un 429 o un 403 de bloqueo, el cliente se queda en pausa
 * el tiempo que diga Retry-After y no envía nada más hasta entonces (ni sondeos ni comprobaciones de salud): insistir
 * durante la pausa solo alargaría el bloqueo.
 */

export class ApiError extends Error {
  /** 0 = sin respuesta (red caída, backend apagado o subida cancelada) */
  readonly status: number;
  /** Texto `detail` del ProblemDetails del backend, si lo hay */
  readonly detail: string | null;
  /** Código de error del backend: `code` de ProblemDetails o `error` de ErrorResponse ("MeetingRetryLimitExceeded"…) */
  readonly code: string | null;
  /** Identificador para buscar el fallo en los registros del servidor */
  readonly correlationId: string | null;
  /** Segundos de espera que pide el servidor (429 y 403 de bloqueo) */
  readonly retryAfter: number | null;

  constructor(status: number, info: { detail?: string | null; code?: string | null; correlationId?: string | null; retryAfter?: number | null } = {}) {
    super(info.detail ?? info.code ?? `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.detail = info.detail ?? null;
    this.code = info.code ?? null;
    this.correlationId = info.correlationId ?? null;
    this.retryAfter = info.retryAfter ?? null;
  }
}

// ── Pausa por límites del servidor ────────────────────────────────────────────

/** Código local para las peticiones que ni se envían porque el cliente está en pausa */
export const PAUSED_CODE = 'ClientPaused';
const BLOCKED_CODE = 'ClientTemporarilyBlocked';
const CONCURRENCY_CODE = 'RequestConcurrencyLimited';

export interface ApiPause {
  /** Date.now() hasta el que no se envía nada */
  until: number;
  /** true si es un bloqueo de la IP (403), no solo un límite de ritmo (429) */
  blocked: boolean;
}

let pause: ApiPause | null = null;
const pauseListeners = new Set<(pause: ApiPause | null) => void>();

const emitPause = () => pauseListeners.forEach((listener) => listener(pause));

export function currentPause(): ApiPause | null {
  if (pause && Date.now() >= pause.until) {
    pause = null;
    emitPause();
  }
  return pause;
}

export function onPauseChange(listener: (pause: ApiPause | null) => void): () => void {
  pauseListeners.add(listener);
  return () => pauseListeners.delete(listener);
}

function startPause(seconds: number, blocked: boolean) {
  const until = Date.now() + Math.max(1, seconds) * 1000;
  if (pause && pause.until >= until) return;
  pause = { until, blocked: blocked || (pause?.blocked ?? false) };
  emitPause();
  setTimeout(currentPause, until - Date.now() + 50);
}

/** Lanza sin tocar la red si el servidor pidió esperar */
function guard() {
  const active = currentPause();
  if (active) throw new ApiError(429, { code: PAUSED_CODE, retryAfter: Math.ceil((active.until - Date.now()) / 1000) });
}

function retryAfterOf(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds;
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, Math.round((date - Date.now()) / 1000));
}

/** Construye el ApiError a partir de estado, cabeceras y cuerpo (ProblemDetails, ErrorResponse o vacío) y activa la pausa si toca */
function toApiError(status: number, header: (name: string) => string | null, text: string): ApiError {
  let body: (ProblemDetailsDto & Partial<ErrorDto>) | null = null;
  try {
    const parsed: unknown = text ? JSON.parse(text) : null;
    if (parsed && typeof parsed === 'object') body = parsed as ProblemDetailsDto & Partial<ErrorDto>;
  } catch {
    /* sin cuerpo JSON (401, 404, 413 y 415 suelen venir vacíos) */
  }
  const code = typeof body?.code === 'string' ? body.code : typeof body?.error === 'string' ? body.error : null;
  const error = new ApiError(status, {
    detail: typeof body?.detail === 'string' ? body.detail : null,
    code,
    correlationId: (typeof body?.correlationId === 'string' ? body.correlationId : null) ?? header('X-Correlation-ID'),
    retryAfter: retryAfterOf(header('Retry-After')),
  });
  // RequestConcurrencyLimited (demasiadas peticiones abiertas a la vez, p. ej. un tercer flujo de progreso) no penaliza la
  // IP ni frena el resto: falla solo esa petición. Los demás 429 son de ritmo y paran todo durante Retry-After.
  if (status === 429 && code !== CONCURRENCY_CODE) startPause(error.retryAfter ?? 60, false);
  else if (status === 403 && (code === BLOCKED_CODE || error.retryAfter != null)) startPause(error.retryAfter ?? 120, true);
  return error;
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  guard();
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0);
  }
  if (!response.ok) throw toApiError(response.status, (name) => response.headers.get(name), await response.text().catch(() => ''));
  return response;
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

/** GET /health (sin clave). No comprueba BD, FFmpeg ni modelos, solo que el proceso responde. null: en pausa, no se pregunta. */
export async function ping(signal?: AbortSignal): Promise<boolean | null> {
  if (currentPause()) return null;
  try {
    const response = await fetch('/health', { signal, cache: 'no-store' });
    if (response.status === 429 || response.status === 403) {
      toApiError(response.status, (name) => response.headers.get(name), await response.text().catch(() => ''));
      return null;
    }
    return response.ok;
  } catch {
    return false;
  }
}

/** Estado de los motores locales (Whisper, FFmpeg, diarización y Ollama para el resumen) */
export async function getTranscriptionConfig(signal?: AbortSignal): Promise<TranscriptionConfigDto> {
  return (await request('/api/transcription/configuration', { signal })).json();
}

export async function getMeeting(id: string, signal?: AbortSignal): Promise<MeetingStatusDto> {
  return (await request(`/api/meetings/${id}`, { signal })).json();
}

/** 409 mientras la reunión no esté en Completed */
export async function getTranscript(id: string, signal?: AbortSignal): Promise<TranscriptDto> {
  return (await request(`/api/meetings/${id}/transcript`, { signal })).json();
}

export async function getTranscriptTxt(id: string): Promise<Blob> {
  return (await request(`/api/meetings/${id}/transcript.txt`)).blob();
}

/** 409 si no está en Failed o se agotaron los reintentos (MeetingRetryLimitExceeded) · 503 si falta un motor local */
export async function retryMeeting(id: string): Promise<RetryDto> {
  return (await request(`/api/meetings/${id}/retry`, { method: 'POST' })).json();
}

/** Manifiesto de archivos que se pueden guardar en la carpeta local (y cuándo caduca la copia del servidor) */
export async function getLocalExport(id: string, signal?: AbortSignal): Promise<LocalExportDto> {
  return (await request(`/api/meetings/${id}/local-export`, { signal })).json();
}

/**
 * Genera un borrador de resumen con el modelo local del servidor (Ollama). Tarda minutos y solo admite uno a la vez,
 * así que se llama únicamente a petición del usuario y nunca se reintenta solo. 409 sin transcripción completa · 413 más
 * de 500.000 caracteres · 502 respuesta no válida del modelo · 503 Ollama parado, sin modelo u ocupado · 504 tardó demasiado.
 */
export async function generateSummary(id: string, signal?: AbortSignal): Promise<SummaryResponseDto> {
  return (await request(`/api/meetings/${id}/summary`, { method: 'POST', signal })).json();
}

/** Descarga un archivo del manifiesto como respuesta en streaming (el cuerpo se escribe en disco sin cargarlo en memoria) */
export async function fetchArtifact(artifact: LocalArtifactDto, signal?: AbortSignal): Promise<Response> {
  if (!artifact.url) throw new ApiError(404);
  return request(artifact.url, { method: artifact.method, signal });
}

/**
 * Elimina de verdad, en el servidor, el original y la transcripción de una reunión finalizada. Irreversible. Hay que
 * llamar solo cuando los archivos ya están guardados y cerrados. 409 si la reunión sigue activa.
 */
export async function confirmLocalExport(id: string, signal?: AbortSignal): Promise<void> {
  const body: ConfirmExportDto = { filesSaved: true };
  await request(`/api/meetings/${id}/local-export/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

// ── Progreso en tiempo real ───────────────────────────────────────────────────

/** Foto actual del progreso (la misma que emite el flujo). Para consultas puntuales, p. ej. tras un corte. */
export async function getProgress(id: string, signal?: AbortSignal): Promise<MeetingProgressDto> {
  return (await request(`/api/meetings/${id}/progress`, { signal })).json();
}

/**
 * Por qué terminó un flujo sin llegar a un estado final:
 *  missing   el backend no tiene /events (versión antigua): no se vuelve a intentar en un rato
 *  gone      la reunión ya no existe en el servidor (404 MeetingNotFound)
 *  rejected  401, 403, 429 (p. ej. más de 2 flujos por IP) o 5xx: esperar `retryAfterMs` antes de reintentar
 *  cut       se cortó la conexión o dejaron de llegar latidos: se puede reconectar enseguida
 */
export type StreamEnd = 'missing' | 'gone' | 'rejected' | 'cut';

export interface MeetingStreamHandlers {
  onOpen: () => void;
  /** Eventos `progress` y `heartbeat`: los dos traen la foto completa */
  onProgress: (progress: MeetingProgressDto) => void;
  /** Foto final (Completed o Failed). El flujo ya está cerrado. */
  onTerminal: (progress: MeetingProgressDto) => void;
  onEnd: (reason: StreamEnd, retryAfterMs: number) => void;
}

/** Sin el endpoint, se recuerda unos minutos para no insistir: las rutas inexistentes cuentan para el bloqueo por IP */
let streamMissingUntil = 0;
const STREAM_RECHECK_MS = 5 * 60_000;
/** El servidor manda un latido cada 2 s: tanto tiempo sin nada es una conexión muerta */
const STREAM_SILENCE_MS = 10_000;

export const streamAvailable = () => Date.now() >= streamMissingUntil && !currentPause();

/**
 * GET /api/meetings/{id}/events con fetch (no EventSource): así se leen el código de estado, `code` y `Retry-After` de
 * los rechazos, y se cancela con AbortController. La clave la añade el proxy. Los bytes pueden partir un evento entre
 * dos bloques: se decodifica UTF-8 en streaming y se separan los eventos por línea vacía.
 */
export function streamMeeting(id: string, handlers: MeetingStreamHandlers): { close: () => void } {
  const controller = new AbortController();
  let finished = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;

  const finish = (reason: StreamEnd | null, retryAfterMs = 0) => {
    if (finished) return;
    finished = true;
    clearTimeout(watchdog);
    controller.abort();
    if (reason) handlers.onEnd(reason, retryAfterMs);
  };
  const alive = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => finish('cut'), STREAM_SILENCE_MS);
  };

  const frame = (raw: string) => {
    let event = 'message';
    const data: string[] = [];
    for (const line of raw.split('\n')) {
      if (line.startsWith(':')) continue; // comentario
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if ((event !== 'progress' && event !== 'heartbeat') || data.length === 0) return;
    let progress: MeetingProgressDto;
    try {
      progress = JSON.parse(data.join('\n')) as MeetingProgressDto;
    } catch {
      return;
    }
    if (progress.isTerminal) {
      handlers.onTerminal(progress);
      finish(null);
    } else {
      handlers.onProgress(progress);
    }
  };

  void (async () => {
    const pause = currentPause();
    if (pause) return finish('rejected', pause.until - Date.now());
    if (Date.now() < streamMissingUntil) return finish('missing');

    let response: Response;
    try {
      response = await fetch(`/api/meetings/${id}/events`, { headers: { Accept: 'text/event-stream' }, cache: 'no-store', signal: controller.signal });
    } catch {
      return finish('cut');
    }
    if (finished) return;
    const isStream = response.ok && (response.headers.get('Content-Type') ?? '').startsWith('text/event-stream');
    if (!isStream || !response.body) {
      const error = toApiError(response.status, (name) => response.headers.get(name), await response.text().catch(() => ''));
      if (response.status === 404 && error.code === 'MeetingNotFound') return finish('gone');
      if (response.status === 404 || response.status === 405 || response.ok) {
        streamMissingUntil = Date.now() + STREAM_RECHECK_MS;
        return finish('missing');
      }
      return finish('rejected', (error.retryAfter ?? 30) * 1000);
    }

    handlers.onOpen();
    alive();
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done || finished) break;
        alive();
        buffer = (buffer + value).replace(/\r\n?/g, '\n');
        for (let cut = buffer.indexOf('\n\n'); cut >= 0 && !finished; cut = buffer.indexOf('\n\n')) {
          frame(buffer.slice(0, cut));
          buffer = buffer.slice(cut + 2);
        }
      }
    } catch {
      /* conexión cortada o cancelada */
    }
    // Terminó sin estado final: el servidor se reinició, un proxy cortó… El trabajo sigue; se puede reconectar.
    finish('cut');
  })();

  return { close: () => finish(null) };
}

/**
 * POST /api/meetings?fileName=…&language=… con el archivo como cuerpo binario (application/octet-stream).
 * Se usa XHR y no fetch porque fetch no informa del progreso de subida. 202 → estado inicial (Queued).
 * 503 si falta un motor local (ErrorResponse con el código). Nunca se reintenta sola: podría duplicar el trabajo.
 */
export function uploadMeeting(
  blob: Blob,
  fileName: string,
  language: string,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<MeetingStatusDto> {
  return new Promise((resolve, reject) => {
    try {
      guard();
    } catch (error) {
      reject(error);
      return;
    }
    const xhr = new XMLHttpRequest();
    const query = new URLSearchParams({ fileName, language });
    xhr.open('POST', `/api/meetings?${query}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as MeetingStatusDto);
        } catch {
          reject(new ApiError(xhr.status));
        }
        return;
      }
      reject(toApiError(xhr.status, (name) => xhr.getResponseHeader(name), xhr.responseText));
    };
    xhr.onerror = () => reject(new ApiError(0));
    xhr.onabort = () => reject(new DOMException('Subida cancelada', 'AbortError'));
    if (signal.aborted) {
      reject(new DOMException('Subida cancelada', 'AbortError'));
      return;
    }
    const abort = () => xhr.abort();
    signal.addEventListener('abort', abort, { once: true });
    xhr.onloadend = () => signal.removeEventListener('abort', abort);
    xhr.send(blob);
  });
}
