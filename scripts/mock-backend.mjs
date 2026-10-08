#!/usr/bin/env node
/*
 * Backend simulado de MeetingTranscriber.Api para desarrollar el frontal sin SQL Server, FFmpeg, Whisper ni Ollama.
 * Reproduce el contrato (docs/openapi.json del backend): rutas, DTOs, estados, códigos HTTP, hablantes globales
 * ("Hablante 1"…), límite de reintentos, estado de los motores y el límite de lecturas por minuto con 429 + Retry-After.
 *
 *   pnpm dev:mock                   mock + Vite apuntando a él (lo normal)
 *   pnpm mock                       solo el mock, en http://localhost:5290 (no en 52610/52611, los puertos de la API real)
 *   PORT=5080 pnpm mock             otro puerto
 *   MOCK_TIMING=chunk pnpm mock     simula un resultado antiguo (un solo tiempo por fragmento, sin hablantes)
 *   MOCK_NOT_READY=1 pnpm dev:mock   motores sin preparar: configuración ready=false y subidas con 503 WhisperModelMissing
 *   MOCK_READ_LIMIT=10 pnpm dev:mock lecturas por minuto y endpoint antes del 429 (60 por defecto, como el real)
 *
 * Progreso en tiempo real como el backend real (docs/LIVE-PROGRESS.md del backend): GET /progress, `progress` dentro del
 * estado y GET /events (SSE) con eventos `progress` y `heartbeat` cada 2 s, las 12 fases, porcentaje por fase y voces.
 * El primer hablante se presenta («me llamo Marta»), así que la transcripción trae su nombre detectado.
 *   MOCK_NO_EVENTS=1 pnpm dev:mock   backend antiguo, sin progreso en tiempo real: la interfaz usa el sondeo del estado
 *
 * Incluye el flujo de carpeta local: copia temporal de 24 h (temporaryExpiresAt), manifiesto /local-export, original en
 * /recording, resumen simulado en /summary y confirmación que BORRA la reunión (después, todo responde 404).
 *   MOCK_NO_AI=1 pnpm dev:mock       el resumen responde 503 SummaryUnavailable, como un servidor con Ollama parado
 *
 * Trucos para probar: un archivo con «fail» en el nombre falla con NoAudio la primera vez y funciona al reintentar.
 * No guarda nada en disco: al reiniciar el mock se pierden las reuniones (el frontal lo trata como 404).
 */
import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 5290);
const API_KEY = process.env.MOCK_API_KEY ?? 'meeting-transcriber-local-development-key';
const TIMING = process.env.MOCK_TIMING === 'chunk' ? 'chunk' : 'segment';
const MAX_BYTES = 2_000_000_000;
const EXTENSIONS = ['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.mp4', '.mov', '.mkv', '.webm', '.aac'];
const CHUNK_SECONDS = 600;
const STEP_MS = 2200;
const RETENTION_HOURS = 24;
const NO_AI = process.env.MOCK_NO_AI === '1';
const NOT_READY = process.env.MOCK_NOT_READY === '1';
const READ_LIMIT = Number(process.env.MOCK_READ_LIMIT ?? 60);
const MAX_RETRIES = 3;
const SPEAKER_NUMBER = { A: 1, B: 2, C: 3 };
const NO_EVENTS = process.env.MOCK_NO_EVENTS === '1';
const HEARTBEAT_MS = 2_000;
const NAMES = { es: 'Marta', en: 'Marta' };

/** Guion de ejemplo: incluye importes, fechas, tareas y preguntas para que el análisis tenga algo que encontrar */
const SCRIPTS = {
  es: [
    ['A', 'Buenos días a todos, me llamo Marta y voy a moderar. Empezamos con el estado del contrato de la nave de Getafe.'],
    ['B', 'Buenos días. Hemos revisado la última versión y hay dos cláusulas que todavía no cuadran con lo acordado.'],
    ['A', '¿Cuáles son exactamente? Necesito saberlo antes de hablar con el cliente.'],
    ['B', 'La cláusula séptima sobre penalizaciones y la de revisión de precios. Propone un 3% anual, y nosotros habíamos hablado del 2%.'],
    ['C', 'Yo me encargo de preparar una contrapropuesta y te la envío antes del viernes.'],
    ['A', 'Perfecto. Sobre el presupuesto: el cliente acepta 12.500 euros por la primera fase, pero quiere el desglose.'],
    ['C', 'Tenemos que cerrar también la fecha de entrega. Yo proponía el 15 de noviembre, aunque dependemos del permiso municipal.'],
    ['B', '¿Y si el permiso se retrasa? Deberíamos incluir una cláusula de prórroga automática de 30 días.'],
    ['A', 'Totalmente de acuerdo. Hay que dejarlo por escrito y compartirlo con el cliente la semana que viene.'],
    ['C', 'Hay otro tema pendiente: el seguro de responsabilidad civil cubre hasta 300.000 € y el cliente pide el doble.'],
    ['A', 'Lo consulto con la aseguradora. Quedamos en revisarlo el 3 de octubre en la próxima reunión.'],
    ['B', 'Muy bien. ¿Alguna cosa más antes de cerrar?'],
    ['A', 'Nada más por mi parte. Gracias, y buen trabajo a todos.'],
    ['C', 'Voy a enviar el acta de esta reunión esta tarde para que la validéis.'],
  ],
  en: [
    ['A', "Good morning everyone, my name is Marta and I'll chair today. Let's start with the status of the warehouse contract."],
    ['B', "Morning. We reviewed the latest draft and there are two clauses that still don't match what we agreed."],
    ['A', 'Which ones exactly? I need to know before I talk to the client.'],
    ['B', 'The penalties clause and the price review one. They propose 3% a year, and we had talked about 2%.'],
    ['C', "I'll prepare a counter-proposal and send it to you before Friday."],
    ['A', 'Great. On the budget: the client accepts $12,500 for the first phase, but wants a breakdown.'],
    ['C', 'We need to close the delivery date too. I was proposing November 15th, though we depend on the city permit.'],
    ['B', 'What if the permit is late? We should include an automatic 30-day extension clause.'],
    ['A', "Fully agree. Let's put it in writing and share it with the client next week."],
    ['C', 'Another open point: the liability insurance covers up to $300,000 and the client wants double.'],
    ['A', "I'll check with the insurer. Next steps: we review it on October 3rd at the next meeting."],
    ['B', 'Sounds good. Anything else before we wrap up?'],
    ['A', 'Nothing from me. Thanks, everyone, good work.'],
    ['C', "I'll send the minutes of this meeting this afternoon for you to validate."],
  ],
};

/** @type {Map<string, any>} */
const meetings = new Map();

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};
const problem = (res, status, detail, code = null) => {
  res.writeHead(status, { 'Content-Type': 'application/problem+json' });
  res.end(JSON.stringify({ status, detail, ...(code ? { code, correlationId: res.getHeader('X-Correlation-ID') } : {}) }));
};

/** Lecturas por endpoint (plantilla, no UUID concreto) en el último minuto, como RequestLimits:ReadPerMinute */
const reads = new Map();
function overLimit(route) {
  const now = Date.now();
  const recent = (reads.get(route) ?? []).filter((at) => now - at < 60_000);
  recent.push(now);
  reads.set(route, recent);
  return recent.length > READ_LIMIT ? Math.ceil((recent[0] + 60_000 - now) / 1000) : 0;
}
/** Voces detectadas y, tras la fase de nombres, el de quien se presentó */
const speakersOf = (m) => {
  if (!m.voices) return [];
  return m.voices.map((speakerId) => {
    const name = m.named && speakerId === 'Hablante 1' ? NAMES[m.language] ?? null : null;
    return { speakerId, displayName: name ?? speakerId, name, nameSource: name ? 'SelfIntroduction' : null, evidenceSegmentIndices: name ? [0] : [] };
  });
};

/** MeetingProgressResponse, como el del backend */
const progressView = (m) => {
  const terminal = m.status === 'Completed' || m.status === 'Failed';
  const now = new Date();
  return {
    meetingId: m.id,
    runId: m.run.runId,
    version: m.run.version,
    retryCount: m.retryCount,
    processingCorrelationId: m.run.runId ? m.run.runId.slice(0, 16) : null,
    status: m.status,
    stage: terminal ? m.status : m.run.stage,
    step: m.run.step,
    message: m.run.stage,
    stagePercent: m.run.percent,
    completedChunks: m.completedChunks,
    totalChunks: m.totalChunks,
    currentChunk: m.run.currentChunk,
    processedAudioSeconds: m.run.processed,
    audioDurationSeconds: m.totalChunks > 0 ? m.totalChunks * CHUNK_SECONDS : null,
    startedAt: m.run.startedAt,
    updatedAt: m.run.updatedAt,
    serverTime: now.toISOString(),
    elapsedSeconds: m.run.startedAt ? Math.round(((terminal ? Date.parse(m.run.updatedAt) : now.getTime()) - Date.parse(m.run.startedAt)) / 100) / 10 : null,
    errorCode: m.errorCode,
    errorMessage: m.errorMessage,
    isTerminal: terminal,
    speakers: speakersOf(m),
  };
};

const statusView = (m) => ({
  id: m.id,
  fileName: m.fileName,
  language: m.language,
  createdAt: m.createdAt,
  status: m.status,
  completedChunks: m.completedChunks,
  totalChunks: m.totalChunks,
  errorCode: m.errorCode,
  temporaryExpiresAt: m.temporaryExpiresAt,
  retryCount: m.retryCount,
  errorMessage: m.errorMessage,
  ...(NO_EVENTS ? {} : { progress: progressView(m) }),
});

const newRun = () => ({ runId: null, version: 0, stage: 'Queued', step: null, percent: null, currentChunk: null, processed: null, startedAt: null, updatedAt: new Date().toISOString() });

/** Suscriptores del flujo en directo por reunión: (foto) => void */
const listeners = new Map();
/** Cambia la fase (o su avance) y avisa a los flujos abiertos */
function report(m, changes) {
  Object.assign(m.run, changes, { version: m.run.version + 1, updatedAt: new Date().toISOString() });
  for (const listener of listeners.get(m.id) ?? []) listener('progress', progressView(m));
}

function segmentsForChunk(m, index) {
  const script = SCRIPTS[m.language] ?? SCRIPTS.en;
  const offset = index * CHUNK_SECONDS;
  if (TIMING === 'chunk') {
    return [{ startSeconds: offset, endSeconds: offset + CHUNK_SECONDS, text: script.map(([, text]) => text).join(' '), speaker: null }];
  }
  const slot = CHUNK_SECONDS / script.length;
  return script.map(([speaker, text], i) => ({
    startSeconds: +(offset + i * slot).toFixed(2),
    endSeconds: +(offset + i * slot + slot * 0.86).toFixed(2),
    text,
    speaker: TIMING === 'chunk' ? `chunk-${index}:${speaker}` : i === 11 ? null : `Hablante ${SPEAKER_NUMBER[speaker]}`,
  }));
}

/** Cola secuencial como el BackgroundService real: de uno en uno, con las mismas fases que ProcessMeeting */
let working = false;
async function pump() {
  if (working) return;
  working = true;
  try {
    for (let next = [...meetings.values()].find((m) => m.status === 'Queued'); next; next = [...meetings.values()].find((m) => m.status === 'Queued')) {
      const m = next;
      m.status = 'Processing';
      m.run.runId = randomUUID();
      m.run.startedAt = new Date().toISOString();
      report(m, { stage: 'ExtractingAudio', percent: null });
      await sleep(STEP_MS * 0.4);
      m.totalChunks = 3; // el real divide en fragmentos de ~10 min; aquí siempre 3 para ver el progreso
      for (let p = 0; p <= 100; p += 50) {
        report(m, { stage: 'PreparingChunks', percent: p });
        await sleep(STEP_MS * 0.12);
      }
      report(m, { stage: 'LoadingDiarizationModel', percent: null });
      await sleep(STEP_MS * 0.3);
      for (const [index, step] of ['Segmentation', 'SpeakerCounting', 'Embeddings', 'Clustering'].entries()) {
        report(m, { stage: 'DetectingSpeakers', step, percent: index * 25 });
        await sleep(STEP_MS * 0.25);
      }
      m.voices = ['Hablante 1', 'Hablante 2', 'Hablante 3'];
      report(m, { stage: 'LoadingTranscriptionModel', step: null, percent: null });
      await sleep(STEP_MS * 0.3);
      for (let i = 0; i < m.totalChunks; i++) {
        if (/fail/i.test(m.fileName) && !m.retried && i === 1) {
          await sleep(STEP_MS * 0.5);
          m.status = 'Failed';
          m.errorCode = 'NoAudio';
          m.errorMessage = 'No se obtuvieron segmentos de voz transcritos.';
          break;
        }
        // Callbacks de Whisper: el porcentaje avanza con el audio procesado, ponderado por la duración de los fragmentos
        for (let tick = 1; tick <= 4; tick++) {
          await sleep(STEP_MS / 4);
          const processed = (i + tick / 4) * CHUNK_SECONDS;
          report(m, { stage: 'Transcribing', currentChunk: i + 1, processed, percent: Math.round((processed / (m.totalChunks * CHUNK_SECONDS)) * 1000) / 10 });
        }
        m.segments.push(...segmentsForChunk(m, i));
        m.completedChunks++;
        report(m, {});
      }
      if (m.status === 'Processing') {
        report(m, { stage: 'IdentifyingSpeakers', percent: null, currentChunk: null });
        await sleep(STEP_MS * 0.4);
        m.named = true;
        report(m, { stage: 'SavingResults' });
        await sleep(STEP_MS * 0.2);
        m.status = 'Completed';
      }
      report(m, { currentChunk: null, step: null, percent: null });
    }
  } finally {
    working = false;
  }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function authorized(req) {
  const given = Buffer.from(String(req.headers['x-api-key'] ?? ''));
  const wanted = Buffer.from(API_KEY);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  res.setHeader('X-Correlation-ID', randomUUID().slice(0, 18));
  const log = (status) => console.log(`${req.method} ${path}${url.search ? '?…' : ''} → ${status}`);
  res.on('finish', () => log(res.statusCode));

  if (path === '/health') return json(res, 200, { status: 'ok' });
  if (!authorized(req)) {
    res.writeHead(401);
    return res.end();
  }

  if (req.method === 'GET') {
    const route = path.replace(/[0-9a-f-]{36}/i, '{id}');
    const wait = overLimit(route);
    if (wait > 0) {
      res.setHeader('Retry-After', String(wait));
      return problem(res, 429, null, 'RateLimitExceeded');
    }
  }

  if (req.method === 'GET' && path === '/api/transcription/configuration') {
    return json(res, 200, {
      provider: 'Whisper.net',
      model: 'ggml-large-v3-turbo.bin',
      modelAvailable: !NOT_READY,
      ffmpegAvailable: true,
      diarizationEnabled: true,
      diarizationAvailable: true,
      ready: !NOT_READY,
      errorCode: NOT_READY ? 'WhisperModelMissing' : null,
      summaryProvider: 'Ollama (local)',
      summaryModel: 'qwen3:8b',
      summaryReady: !NO_AI,
      summaryErrorCode: NO_AI ? 'SummaryUnavailable' : null,
    });
  }

  const one = /^\/api\/meetings\/([0-9a-f-]{36})(\/transcript\.txt|\/transcript|\/retry|\/events|\/progress|\/local-export\/confirm|\/local-export|\/recording|\/summary)?$/i.exec(path);

  if (req.method === 'POST' && path === '/api/meetings') {
    if (req.headers['content-type'] !== 'application/octet-stream') {
      res.writeHead(415);
      return res.end();
    }
    const fileName = url.searchParams.get('fileName') ?? '';
    const language = url.searchParams.get('language') || 'es';
    const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
    // Se consume siempre el cuerpo para que el navegador vea el progreso completo
    let bytes = 0;
    const parts = [];
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes <= 50_000_000) parts.push(chunk); // el mock guarda en memoria solo los archivos pequeños
    }
    if (bytes > MAX_BYTES) {
      res.writeHead(413);
      return res.end();
    }
    if (!EXTENSIONS.includes(ext)) return problem(res, 400, 'Formato no permitido.');
    if (!/^[a-zA-Z]{2}$/.test(language)) return problem(res, 400, 'Usa un idioma ISO de dos letras: es, en...');
    if (NOT_READY) return json(res, 503, { error: 'WhisperModelMissing' });
    const meeting = {
      id: randomUUID(),
      fileName: fileName.split(/[\\/]/).pop(),
      language: language.toLowerCase(),
      createdAt: new Date().toISOString(),
      status: 'Queued',
      completedChunks: 0,
      totalChunks: 0,
      errorCode: null,
      errorMessage: null,
      retryCount: 0,
      run: newRun(),
      voices: null,
      named: false,
      segments: [],
      bytes,
      body: bytes <= 50_000_000 ? Buffer.concat(parts) : null,
      temporaryExpiresAt: new Date(Date.now() + RETENTION_HOURS * 3600_000).toISOString(),
      retried: false,
    };
    meetings.set(meeting.id, meeting);
    res.setHeader('Location', `/api/meetings/${meeting.id}`);
    json(res, 202, statusView(meeting));
    void pump();
    return;
  }

  if (one) {
    const meeting = meetings.get(one[1].toLowerCase());
    if (!meeting) return problem(res, 404, null, 'MeetingNotFound');
    const [, , sub] = one;
    if (req.method === 'GET' && !sub) return json(res, 200, statusView(meeting));
    if (req.method === 'GET' && (sub === '/events' || sub === '/progress') && NO_EVENTS) return problem(res, 404, null, 'ResourceNotFound');
    if (req.method === 'GET' && sub === '/progress') return json(res, 200, progressView(meeting));
    if (req.method === 'GET' && sub === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      const send = (event, data) => {
        const id = `${data.retryCount}:${data.runId ? data.runId.replaceAll('-', '') : 'snapshot'}:${data.version}`;
        // El JSON se parte a propósito en dos escrituras: el cliente tiene que juntar los trozos de un mismo evento
        const frame = `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        const cut = Math.floor(frame.length / 2);
        res.write(frame.slice(0, cut));
        res.write(frame.slice(cut));
      };
      let last = progressView(meeting);
      send('progress', last);
      if (last.isTerminal) return res.end();
      const listener = (event, data) => {
        last = data;
        send(event, data);
        if (data.isTerminal) {
          cleanup();
          res.end();
        }
      };
      // Latido: la foto completa, aunque no haya cambios
      const heartbeat = setInterval(() => send('heartbeat', progressView(meeting)), HEARTBEAT_MS);
      const cleanup = () => {
        clearInterval(heartbeat);
        listeners.get(meeting.id)?.delete(listener);
      };
      if (!listeners.has(meeting.id)) listeners.set(meeting.id, new Set());
      listeners.get(meeting.id).add(listener);
      req.on('close', cleanup);
      return;
    }
    if (req.method === 'GET' && sub === '/transcript') {
      if (meeting.status !== 'Completed') return json(res, 409, { error: 'TranscriptNotCompleted' });
      const speakers = speakersOf(meeting);
      const shown = Object.fromEntries(speakers.map((speaker) => [speaker.speakerId, speaker.displayName]));
      const segments =
        TIMING === 'chunk' ? meeting.segments : meeting.segments.map((segment) => ({ ...segment, speakerId: segment.speaker, speaker: segment.speaker ? (shown[segment.speaker] ?? segment.speaker) : null }));
      return json(res, 200, { id: meeting.id, language: meeting.language, timing: TIMING, speakerScope: TIMING === 'chunk' ? 'chunk' : 'meeting', segments, speakers: TIMING === 'chunk' ? [] : speakers });
    }
    if (req.method === 'GET' && sub === '/transcript.txt') {
      if (meeting.status !== 'Completed') {
        res.writeHead(409);
        return res.end();
      }
      const clock = (s) => new Date(s * 1000).toISOString().slice(11, 19);
      const text = meeting.segments.map((s) => `[${clock(s.startSeconds)}] ${s.speaker ?? 'Hablante sin determinar'}: ${s.text}`).join('\n');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="${meeting.id}.txt"` });
      return res.end(text);
    }
    if (req.method === 'GET' && sub === '/local-export') {
      const ready = meeting.status === 'Completed';
      const ext = meeting.fileName.slice(meeting.fileName.lastIndexOf('.'));
      return json(res, 200, {
        meetingId: meeting.id,
        folderName: `meeting-${meeting.id.replaceAll('-', '')}`,
        destination: 'browser-local-folder',
        temporaryExpiresAt: meeting.temporaryExpiresAt,
        canConfirmExport: meeting.status === 'Completed' || meeting.status === 'Failed',
        artifacts: [
          { kind: 'recording', fileName: `recording${ext}`, contentType: 'application/octet-stream', url: `/api/meetings/${meeting.id}/recording`, method: 'GET', available: Boolean(meeting.body) },
          { kind: 'transcript-json', fileName: 'transcript.json', contentType: 'application/json', url: `/api/meetings/${meeting.id}/transcript`, method: 'GET', available: ready },
          { kind: 'transcript-text', fileName: 'transcript.txt', contentType: 'text/plain', url: `/api/meetings/${meeting.id}/transcript.txt`, method: 'GET', available: ready },
          { kind: 'summary-json', fileName: 'summary.json', contentType: 'application/json', url: `/api/meetings/${meeting.id}/summary`, method: 'POST', available: ready && !NO_AI },
        ],
      });
    }
    if (req.method === 'GET' && sub === '/recording') {
      if (!meeting.body) {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': meeting.body.length });
      return res.end(meeting.body);
    }
    if (req.method === 'POST' && sub === '/summary') {
      if (meeting.status !== 'Completed') return json(res, 409, { error: 'TranscriptNotCompleted' });
      if (NO_AI) return problem(res, 503, 'El servicio local de resumen no está disponible.', 'SummaryUnavailable');
      await sleep(1800); // el modelo local real tarda minutos
      const point = (text, ...evidenceSegmentIndices) => ({ text, evidenceSegmentIndices });
      return json(res, 200, {
        meetingId: meeting.id,
        generatedAt: new Date().toISOString(),
        requiresHumanReview: true,
        summary: {
          overview: 'Se revisa el contrato de la nave: quedan dos cláusulas por cerrar (penalizaciones y revisión de precios), el presupuesto de la primera fase y la fecha de entrega, condicionada al permiso municipal.',
          highlights: [point('El cliente acepta 12.500 euros por la primera fase, pero pide el desglose.', 5), point('La entrega se propone para el 15 de noviembre, sujeta al permiso municipal.', 6)],
          decisions: [point('Incluir una cláusula de prórroga automática de 30 días.', 7, 8)],
          actionItems: [point('Preparar una contrapropuesta y enviarla antes del viernes.', 4), point('Consultar con la aseguradora la cobertura de responsabilidad civil.', 9, 10)],
          openQuestions: [point('¿Qué pasa si el permiso municipal se retrasa?', 7)],
        },
      });
    }
    if (req.method === 'POST' && sub === '/local-export/confirm') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      let body = {};
      try {
        body = JSON.parse(raw);
      } catch {
        /* cuerpo vacío */
      }
      if (body.filesSaved !== true) return json(res, 400, { error: 'LocalFilesNotSaved' });
      if (meeting.status !== 'Completed' && meeting.status !== 'Failed') return json(res, 409, { error: 'MeetingStillActive' });
      meetings.delete(meeting.id);
      res.writeHead(204);
      return res.end();
    }
    if (req.method === 'POST' && sub === '/retry') {
      if (meeting.status !== 'Failed') {
        res.writeHead(409);
        return res.end();
      }
      if (meeting.retryCount >= MAX_RETRIES) return json(res, 409, { error: 'MeetingRetryLimitExceeded' });
      if (NOT_READY) return json(res, 503, { error: 'WhisperModelMissing' });
      Object.assign(meeting, { status: 'Queued', run: newRun(), voices: null, named: false, errorCode: null, errorMessage: null, completedChunks: 0, totalChunks: 0, segments: [], retried: true, retryCount: meeting.retryCount + 1 });
      json(res, 202, { id: meeting.id, status: 'Queued' });
      void pump();
      return;
    }
  }

  res.writeHead(404);
  res.end();
}).listen(PORT, () => {
  console.log(`Mock de MeetingTranscriber.Api en http://localhost:${PORT} (timing: ${TIMING}, lecturas/min: ${READ_LIMIT}${NOT_READY ? ', motores sin preparar' : ''}${NO_AI ? ', sin resumidor' : ''})`);
});
