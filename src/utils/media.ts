/** Extensiones que acepta el backend (MeetingService.Extensions). Si cambian allí, cambian aquí. */
export const SUPPORTED_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.mp4', '.mov', '.mkv', '.webm', '.aac'] as const;

/** Mismo límite que Transcription:MaxUploadBytes del backend (2 GB por defecto) */
export const MAX_FILE_BYTES = (Number(import.meta.env.VITE_MAX_FILE_MB) || 2000) * 1024 * 1024;

export type FileProblem = 'extension' | 'empty' | 'tooLarge';

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

export function stripExtension(name: string): string {
  const ext = extensionOf(name);
  return ext ? name.slice(0, -ext.length) : name;
}

export function validateFile(file: File): FileProblem | null {
  if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(extensionOf(file.name))) return 'extension';
  if (file.size === 0) return 'empty';
  if (file.size > MAX_FILE_BYTES) return 'tooLarge';
  return null;
}

const VIDEO_ONLY = new Set(['.mp4', '.mov', '.mkv']);

export function kindOf(name: string, mime: string): 'audio' | 'video' {
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return VIDEO_ONLY.has(extensionOf(name)) ? 'video' : 'audio';
}

export function extensionForMime(mime: string): string {
  const base = mime.split(';')[0].trim().toLowerCase();
  if (base.includes('webm')) return '.webm';
  if (base.includes('mp4') || base.includes('m4a') || base.includes('aac')) return '.m4a';
  if (base.includes('ogg')) return '.ogg';
  if (base.includes('mpeg')) return '.mp3';
  if (base.includes('wav')) return '.wav';
  return '.webm';
}

/** Nombre apto para el backend: sin rutas, ≤ 200 caracteres y con extensión admitida */
export function serverFileName(title: string, ext: string): string {
  const clean = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150) || 'reunion';
  return `${clean}${ext}`;
}

/** Formato de grabación preferido por el navegador: webm/opus en Chrome y Firefox, mp4 en Safari */
export function pickRecorderMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return candidates.find((mime) => MediaRecorder.isTypeSupported(mime)) ?? '';
}

/** Reduce una serie de niveles a `bars` valores normalizados (0‑1), conservando los picos */
export function toPeaks(levels: ArrayLike<number>, bars = 160): number[] {
  if (levels.length === 0) return [];
  const out: number[] = [];
  const size = levels.length / bars;
  for (let i = 0; i < Math.min(bars, levels.length); i++) {
    const from = Math.floor(i * size);
    const to = Math.max(from + 1, Math.floor((i + 1) * size));
    let max = 0;
    for (let j = from; j < to && j < levels.length; j++) max = Math.max(max, levels[j]);
    out.push(max);
  }
  const top = Math.max(...out, 0.0001);
  return out.map((v) => Math.round((v / top) * 1000) / 1000);
}

/** Duración leyendo los metadatos con un elemento multimedia. null si el navegador no la sabe (p. ej. webm sin cabecera). */
export function probeDuration(blob: Blob, kind: 'audio' | 'video'): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const element = document.createElement(kind === 'video' ? 'video' : 'audio');
    const done = (value: number | null) => {
      clearTimeout(timer);
      element.removeAttribute('src');
      element.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => done(null), 6000);
    element.preload = 'metadata';
    element.onloadedmetadata = () => done(Number.isFinite(element.duration) && element.duration > 0 ? element.duration : null);
    element.onerror = () => done(null);
    element.src = url;
  });
}

/** Archivos por encima de esto no se decodifican en memoria para dibujar la onda */
const MAX_DECODE_BYTES = 120 * 1024 * 1024;

/** Picos de onda decodificando el audio. null si es demasiado grande o el navegador no puede decodificarlo. */
export async function computePeaks(blob: Blob, bars = 160): Promise<number[] | null> {
  if (blob.size > MAX_DECODE_BYTES) return null;
  try {
    const context = new OfflineAudioContext(1, 1, 44100);
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const data = buffer.getChannelData(0);
    const block = Math.max(1, Math.floor(data.length / (bars * 4)));
    const levels = new Float32Array(Math.ceil(data.length / block));
    for (let i = 0; i < levels.length; i++) {
      let max = 0;
      const end = Math.min(data.length, (i + 1) * block);
      for (let j = i * block; j < end; j++) max = Math.max(max, Math.abs(data[j]));
      levels[i] = max;
    }
    return toPeaks(levels, bars);
  } catch {
    return null;
  }
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
