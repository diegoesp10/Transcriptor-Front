#!/usr/bin/env node
/*
 * Comprueba que el contrato OpenAPI que publica el backend (GET /openapi/v1.json) sigue siendo el que espera el frontal
 * (src/api/types.ts + src/api/client.ts). No necesita clave: ese documento es público en Development.
 *
 *   pnpm api:check                       usa BACKEND_URL de .env.development (o de tus .local)
 *   pnpm api:check https://host:puerto   otra URL
 *   pnpm api:check ruta/openapi.json     un archivo de contrato (p. ej. el docs/openapi.json del backend), útil cuando la
 *                                        API no está en marcha o aún no tiene la última versión
 *
 * Termina con código 1 si algo no coincide, así que sirve también en CI.
 */
import { readFileSync } from 'node:fs';

// Mismo orden de prioridad que Vite en desarrollo. loadEnvFile no pisa lo ya definido, así que se carga de más a menos.
for (const file of ['.env.development.local', '.env.local', '.env.development', '.env']) {
  try {
    process.loadEnvFile(file);
  } catch {
    /* no existe */
  }
}

const arg = process.argv[2];
const fromFile = arg?.endsWith('.json') ? arg : null;
const base = (fromFile ? 'file' : (arg ?? process.env.BACKEND_URL ?? process.env.VITE_BACKEND_URL ?? 'https://localhost:52610')).replace(/\/$/, '');
// El certificado de desarrollo de ASP.NET no es de confianza para Node: solo se relaja para localhost
if (/^https:\/\/(localhost|127\.0\.0\.1)/.test(base)) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

/** Lo que el frontal espera. Si el backend cambia, se actualiza aquí a la vez que types.ts. */
const EXPECTED = {
  routes: [
    'GET /health',
    'POST /api/meetings',
    'GET /api/meetings/{id}',
    'GET /api/meetings/{id}/transcript',
    'GET /api/meetings/{id}/transcript.txt',
    'POST /api/meetings/{id}/retry',
    'GET /api/meetings/{id}/local-export',
    'GET /api/meetings/{id}/recording',
    'POST /api/meetings/{id}/summary',
    'POST /api/meetings/{id}/local-export/confirm',
    'GET /api/transcription/configuration',
    'GET /api/meetings/{id}/progress',
    'GET /api/meetings/{id}/events',
  ],
  /** Rutas que existen pero el frontal no usa a propósito (diagnóstico del operador, no para la interfaz) */
  ignoredRoutes: ['GET /api/errors'],
  /** Rutas que el frontal usa si existen y, si no, sustituye por otra cosa: su ausencia se avisa, pero no es un error */
  optionalRoutes: {},
  upload: { query: ['fileName', 'language'], contentType: 'application/octet-stream' },
  enums: {
    JobStatus: ['Queued', 'Processing', 'Completed', 'Failed'],
    TranscriptTiming: ['chunk', 'segment'],
    ProcessingStage: [
      'Queued', 'Processing', 'ExtractingAudio', 'PreparingChunks', 'LoadingDiarizationModel', 'DetectingSpeakers',
      'LoadingTranscriptionModel', 'Transcribing', 'IdentifyingSpeakers', 'SavingResults', 'Completed', 'Failed',
    ],
    ProcessingStep: ['Segmentation', 'SpeakerCounting', 'Embeddings', 'Clustering'],
    SpeakerNameSource: ['SelfIntroduction'],
  },
  schemas: {
    MeetingStatusResponse: ['id', 'fileName', 'language', 'createdAt', 'status', 'completedChunks', 'totalChunks', 'errorCode', 'temporaryExpiresAt', 'retryCount', 'errorMessage', 'progress'],
    MeetingProgressResponse: [
      'meetingId', 'runId', 'version', 'retryCount', 'processingCorrelationId', 'status', 'stage', 'step', 'message',
      'stagePercent', 'completedChunks', 'totalChunks', 'currentChunk', 'processedAudioSeconds', 'audioDurationSeconds',
      'startedAt', 'updatedAt', 'serverTime', 'elapsedSeconds', 'errorCode', 'errorMessage', 'isTerminal', 'speakers',
    ],
    SpeakerIdentity: ['speakerId', 'displayName', 'name', 'nameSource', 'evidenceSegmentIndices'],
    TranscriptionConfigurationResponse: [
      'provider', 'model', 'modelAvailable', 'ffmpegAvailable', 'diarizationEnabled', 'diarizationAvailable', 'ready', 'errorCode',
      'summaryProvider', 'summaryModel', 'summaryReady', 'summaryErrorCode',
    ],
    TranscriptResponse: ['id', 'language', 'timing', 'speakerScope', 'segments', 'speakers'],
    TranscriptSegment: ['startSeconds', 'endSeconds', 'text', 'speaker', 'speakerId'],
    RetryResponse: ['id', 'status'],
    ErrorResponse: ['error'],
    LocalExportResponse: ['meetingId', 'folderName', 'destination', 'temporaryExpiresAt', 'canConfirmExport', 'artifacts'],
    LocalArtifact: ['kind', 'fileName', 'contentType', 'url', 'method', 'available'],
    MeetingSummaryResponse: ['meetingId', 'generatedAt', 'requiresHumanReview', 'summary'],
    MeetingSummary: ['overview', 'highlights', 'decisions', 'actionItems', 'openQuestions'],
    SummaryPoint: ['text', 'evidenceSegmentIndices'],
    ConfirmLocalExportRequest: ['filesSaved'],
  },
};

const problems = [];
/** Diferencias que no rompen nada (rutas opcionales ausentes, campos nuevos que el frontal ignora) */
const notices = [];
const same = (a, b) => a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index]);

let spec;
try {
  if (fromFile) {
    spec = JSON.parse(readFileSync(fromFile, 'utf8'));
  } else {
    const response = await fetch(`${base}/openapi/v1.json`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    spec = await response.json();
  }
} catch (error) {
  console.error(`✗ No se pudo leer ${base}/openapi/v1.json (${error.cause?.code ?? error.message}). ¿Está levantada la API?`);
  process.exit(2);
}

const present = new Set(Object.entries(spec.paths ?? {}).flatMap(([path, ops]) => Object.keys(ops).map((method) => `${method.toUpperCase()} ${path}`)));
for (const route of EXPECTED.routes) if (!present.has(route)) problems.push(`Falta la ruta ${route}`);
for (const [route, why] of Object.entries(EXPECTED.optionalRoutes)) if (!present.has(route)) notices.push(`Aún no existe ${route}: ${why}`);
for (const route of present) {
  const known = EXPECTED.routes.includes(route) || EXPECTED.ignoredRoutes.includes(route) || route in EXPECTED.optionalRoutes;
  if (!known) problems.push(`Ruta nueva que el frontal no usa: ${route}`);
}

const upload = spec.paths?.['/api/meetings']?.post;
for (const name of EXPECTED.upload.query) if (!upload?.parameters?.some((p) => p.in === 'query' && p.name === name)) problems.push(`POST /api/meetings ya no acepta ?${name}=`);
if (!upload?.requestBody?.content?.[EXPECTED.upload.contentType]) problems.push(`POST /api/meetings ya no recibe ${EXPECTED.upload.contentType}`);

const schemas = spec.components?.schemas ?? {};
for (const [name, values] of Object.entries(EXPECTED.enums)) {
  const actual = schemas[name]?.enum?.filter((value) => value !== null);
  if (!actual) problems.push(`Falta el enum ${name}`);
  else if (!same(actual, values)) problems.push(`Enum ${name}: esperado [${values}] · actual [${actual}]`);
}
for (const [name, props] of Object.entries(EXPECTED.schemas)) {
  const actual = Object.keys(schemas[name]?.properties ?? {});
  if (actual.length === 0) problems.push(`Falta el esquema ${name}`);
  else {
    const missing = props.filter((prop) => !actual.includes(prop));
    const extra = actual.filter((prop) => !props.includes(prop));
    if (missing.length > 0) problems.push(`Esquema ${name}: faltan {${missing}}`);
    if (extra.length > 0) notices.push(`Esquema ${name}: campos nuevos que el frontal ignora {${extra}}`);
  }
}

for (const notice of notices) console.warn(`! ${notice}`);
if (problems.length === 0) {
  console.log(`✓ Contrato conforme (${spec.info?.title} ${spec.info?.version}, ${present.size} rutas, ${Object.keys(schemas).length} esquemas) — ${base}`);
} else {
  console.error(`✗ El contrato de ${base} difiere de lo que espera el frontal:`);
  for (const problem of problems) console.error(`  · ${problem}`);
  console.error('Actualiza src/api/types.ts, src/api/client.ts y EXPECTED en scripts/check-contract.mjs.');
  process.exit(1);
}
