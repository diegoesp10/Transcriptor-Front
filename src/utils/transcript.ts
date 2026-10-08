import type { TranscriptDto, TranscriptSegment } from '../api/types';

/*
 * Hablantes y análisis local de la transcripción.
 * Nada de esto usa IA ni sale del navegador: son recuentos y patrones de texto sobre lo que devuelve el backend.
 */

// ── Hablantes ─────────────────────────────────────────────────────────────────

/** Resultados antiguos (speakerScope "chunk"): etiqueta local a cada fragmento */
const CHUNK_SPEAKER = /^chunk-(\d+):(.*)$/;
/** Diarización local (speakerScope "meeting"): "Hablante 1"… estable en toda la reunión */
const MEETING_SPEAKER = /^Hablante (\d{1,3})$/;

export interface ParsedSpeaker {
  /** Fragmento de ~10 min del que viene la etiqueta (0 = primero); null en etiquetas globales */
  chunk: number | null;
  /** Etiqueta ("A", "B"… en resultados antiguos) o la cadena tal cual si no se reconoce */
  label: string;
  /** Número de hablante global ("Hablante 2" → 2) */
  number: number | null;
}

export function parseSpeaker(raw: string): ParsedSpeaker {
  const chunk = CHUNK_SPEAKER.exec(raw);
  if (chunk) return { chunk: Number(chunk[1]), label: chunk[2] || '?', number: null };
  const global = MEETING_SPEAKER.exec(raw);
  return { chunk: null, label: raw, number: global ? Number(global[1]) : null };
}

/**
 * El backend separa la identidad de la voz (`speakerId`: "Hablante 1") de lo que se muestra (`speaker`: "Diego Espina" si
 * se presentó). La interfaz identifica las voces por `speaker` (colores, nombres que pone el usuario), así que aquí se
 * deja en `speaker` la identidad y los nombres detectados aparte. Las transcripciones antiguas (sin `speakerId`) no cambian.
 */
export function normalizeTranscript(dto: TranscriptDto): { dto: TranscriptDto; detected: Record<string, string> } {
  const detected: Record<string, string> = {};
  for (const speaker of dto.speakers ?? []) if (speaker.name) detected[speaker.speakerId] = speaker.name;
  const segments = dto.segments.map((segment) => {
    if (segment.speakerId === undefined) return segment;
    if (segment.speakerId && segment.speaker && segment.speaker !== segment.speakerId) detected[segment.speakerId] ??= segment.speaker;
    return segment.speaker === segment.speakerId ? segment : { ...segment, speaker: segment.speakerId };
  });
  return { dto: { ...dto, segments }, detected };
}

/** Hablantes distintos en orden de aparición (la posición decide su color) */
export function speakersOf(segments: TranscriptSegment[]): string[] {
  const seen = new Set<string>();
  for (const segment of segments) if (segment.speaker) seen.add(segment.speaker);
  return [...seen];
}

/** true si hay etiquetas de más de un fragmento: A del fragmento 0 y A del 1 pueden ser personas distintas */
export function spansChunks(speakers: string[]): boolean {
  return new Set(speakers.map((s) => parseSpeaker(s).chunk)).size > 1;
}

export interface SpeakerNaming {
  /** Nombres que ha puesto el usuario (solo en este navegador): mandan sobre todo lo demás */
  names: Record<string, string>;
  /** Nombres que detectó el servidor porque la persona se presentó */
  detected: Record<string, string>;
  /** "Voz {label}" traducido */
  voice: (label: string) => string;
  /** "Voz A · parte 2" traducido */
  voiceInPart: (label: string, part: number) => string;
  /** "Hablante 2" / "Speaker 2" traducido */
  numbered: (n: number) => string;
  unknown: string;
  multiChunk: boolean;
}

/**
 * Nombre a mostrar de un hablante: el que puso el usuario o, si no, "Hablante 2" (etiquetas globales) o "Voz A" (con la
 * parte si hay varias, en resultados antiguos). null en el servidor significa atribución incierta.
 */
export function speakerName(raw: string | null, naming: SpeakerNaming): string {
  if (!raw) return naming.unknown;
  const custom = naming.names[raw]?.trim();
  if (custom) return custom;
  const detected = naming.detected[raw];
  if (detected) return detected;
  const { chunk, label, number } = parseSpeaker(raw);
  if (number != null) return naming.numbered(number);
  if (chunk == null) return label;
  return naming.multiChunk ? naming.voiceInPart(label, chunk + 1) : naming.voice(label);
}

/** Texto largo → párrafos legibles, cortando por frases (solo para mostrar) */
export function paragraphs(text: string, max = 420): string[] {
  const sentences = text.trim().split(/(?<=[.!?…])\s+/);
  const out: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > max) {
      out.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) out.push(current);
  return out;
}

/** Índice del segmento que suena en `time` (búsqueda binaria; -1 si todavía no ha empezado ninguno) */
export function segmentAt(segments: TranscriptSegment[], time: number): number {
  let low = 0;
  let high = segments.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (segments[mid].startSeconds <= time) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

// ── Análisis ──────────────────────────────────────────────────────────────────

export interface SpeakerStat {
  name: string;
  words: number;
  /** 0‑1 sobre el total de palabras */
  share: number;
  /** Segundos hablando; solo fiable si el servidor da tiempos por frase (timing = "segment") */
  seconds: number;
  turns: number;
  colorIndex: number;
}

export interface Finding {
  segmentIndex: number;
  start: number;
  sentence: string;
  match: string;
}

export interface TimelineBlock {
  start: number;
  end: number;
  colorIndex: number;
  name: string;
}

export interface Analysis {
  words: number;
  durationSec: number;
  wordsPerMinute: number | null;
  speakers: SpeakerStat[];
  /** Hay tiempos reales por frase: se pueden dar segundos hablando y dibujar la línea de tiempo */
  timed: boolean;
  timeline: TimelineBlock[];
  keywords: { word: string; count: number }[];
  questions: Finding[];
  actions: Finding[];
  figures: Finding[];
}

const STOPWORDS = new Set(
  (
    // español
    'para como pero porque cuando donde entonces también tambien está esta estas estos estar están estoy estamos ' +
    'este esto eso esos esas esa ese esta ahora aquí aqui allí allá así asi aunque bien cada cosa cosas dice digo ' +
    'dijo debe puede pueden puedo podemos podría tiene tienen tengo tenemos tenía hace hacer hago hacemos hecho ' +
    'hay había habia será seria sería sido ser soy somos eres fue fueron muy mucho mucha muchos muchas poco ' +
    'más mas menos solo sólo todo toda todos todas todavía todavia nada algo alguien alguna algún algun ' +
    'otro otra otros otras mismo misma sobre entre desde hasta hacia según segun sin con por del las los una uno ' +
    'unos unas que quien quién cual cuál cuales les nos nosotros vosotros ellos ellas usted ustedes vale ' +
    'bueno claro pues sino además ademas buenos buenas días dias tardes noches gracias antes después despues siempre nunca ' +
    'tengo vamos vamos voy vas van iba mira oye venga ' +
    // english
    'that this with from they them their there then than have has had having been being were was will would could ' +
    'should shall might must can cannot just also very really some any each every other such only into onto over ' +
    'about after before because while when where which what whom whose who how why your yours ours mine here ' +
    'going gonna wanna okay yeah right well like know think mean thing things something anything nothing ' +
    'these those more most much many does done doing make made want need get got let lets'
  ).split(/\s+/),
);

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu;

const countWords = (text: string) => text.match(WORD)?.length ?? 0;

/** Construye una expresión que respeta límites de palabra también con tildes y ñ (\b solo entiende ASCII) */
const phrases = (list: string[]) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${list.join('|')})(?![\\p{L}\\p{N}])`, 'iu');

const MONTHS =
  'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|' +
  'january|february|march|april|may|june|july|august|september|october|november|december';
const DAYS = 'lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday';

/** Compromisos y tareas: frases que suelen introducir un acuerdo o algo pendiente */
const ACTION = phrases([
  'tenemos que',
  'tengo que',
  'tienes que',
  'hay que',
  'debemos',
  'deber[ií]amos',
  'necesitamos',
  'me encargo',
  'nos encargamos',
  'se encarga',
  'te encargas',
  'quedamos en',
  'hemos acordado',
  'acordamos',
  'queda pendiente',
  'pendiente de',
  'voy a (?:enviar|mandar|preparar|revisar|hacer|llamar|escribir|redactar|comprobar)',
  'te (?:env[ií]o|mando|paso)',
  'os (?:env[ií]o|mando|paso)',
  'lo (?:env[ií]o|mando|reviso|preparo)',
  `antes del? (?:${DAYS}|\\d{1,2}|fin de)`,
  `para el (?:${DAYS}|\\d{1,2})`,
  'we need to',
  'we should',
  'we must',
  "i(?:'ll| will)",
  "we(?:'ll| will)",
  "let(?:'|’)s",
  'action items?',
  'follow[- ]up',
  'next steps?',
  'deadline',
  `by (?:${DAYS}|end of)`,
  'can you (?:send|prepare|review|check)',
]);

/** Cifras y fechas: justo lo que conviene verificar contra el audio */
const FIGURE = new RegExp(
  [
    '\\d[\\d.,]*\\s?(?:€|eur(?:os?)?|usd|d[óo]lares|dollars|pounds|libras)(?![\\p{L}])',
    '(?:€|\\$|£)\\s?\\d[\\d.,]*',
    '\\d[\\d.,]*\\s?(?:%|por ciento|percent)',
    '\\b\\d{1,2}[/\\-.]\\d{1,2}(?:[/\\-.]\\d{2,4})?\\b',
    `\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:de\\s+|of\\s+)?(?:${MONTHS})(?:\\s+(?:de\\s+)?\\d{4})?`,
    `(?:${MONTHS})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?`,
  ].join('|'),
  'iu',
);

const sentencesOf = (text: string) => text.split(/(?<=[.!?…])\s+/).filter(Boolean);

const MAX_FINDINGS = 14;

export function analyze(segments: TranscriptSegment[], timing: 'chunk' | 'segment', nameOf: (raw: string | null) => string, colorOf: (raw: string | null) => number): Analysis {
  const byName = new Map<string, SpeakerStat>();
  const frequency = new Map<string, number>();
  const questions: Finding[] = [];
  const actions: Finding[] = [];
  const figures: Finding[] = [];
  const timeline: TimelineBlock[] = [];
  let words = 0;
  let durationSec = 0;
  const timed = timing === 'segment';

  segments.forEach((segment, index) => {
    const name = nameOf(segment.speaker);
    const count = countWords(segment.text);
    words += count;
    durationSec = Math.max(durationSec, segment.endSeconds);

    const stat = byName.get(name) ?? { name, words: 0, share: 0, seconds: 0, turns: 0, colorIndex: colorOf(segment.speaker) };
    stat.words += count;
    stat.turns += 1;
    stat.seconds += Math.max(0, segment.endSeconds - segment.startSeconds);
    byName.set(name, stat);
    if (timed) timeline.push({ start: segment.startSeconds, end: segment.endSeconds, colorIndex: stat.colorIndex, name });

    for (const raw of segment.text.toLowerCase().match(WORD) ?? []) {
      if (raw.length < 4 || STOPWORDS.has(raw) || /^\d+$/.test(raw)) continue;
      frequency.set(raw, (frequency.get(raw) ?? 0) + 1);
    }

    for (const sentence of sentencesOf(segment.text)) {
      const finding = (match: string): Finding => ({ segmentIndex: index, start: segment.startSeconds, sentence: sentence.trim(), match });
      if (sentence.trimEnd().endsWith('?') && questions.length < MAX_FINDINGS) questions.push(finding('?'));
      const action = ACTION.exec(sentence);
      if (action && actions.length < MAX_FINDINGS) actions.push(finding(action[0]));
      const figure = FIGURE.exec(sentence);
      if (figure && figures.length < MAX_FINDINGS) figures.push(finding(figure[0]));
    }
  });

  const speakers = [...byName.values()].sort((a, b) => b.words - a.words);
  for (const speaker of speakers) speaker.share = words > 0 ? speaker.words / words : 0;

  const keywords = [...frequency.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([word, count]) => ({ word, count }));

  return {
    words,
    durationSec,
    wordsPerMinute: timed && durationSec > 30 ? Math.round(words / (durationSec / 60)) : null,
    speakers,
    timed,
    timeline,
    keywords,
    questions,
    actions,
    figures,
  };
}
