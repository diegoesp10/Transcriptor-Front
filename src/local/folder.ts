import { ApiError, fetchArtifact } from '../api/client';
import type { ArtifactKind, LocalArtifactDto, LocalExportDto, SummaryResponseDto } from '../api/types';
import { downloadBlob } from '../utils/media';

/*
 * Guardado en la carpeta local del usuario (File System Access API). Es el destino FINAL de cada reunión: la copia del
 * servidor es temporal. Port a TypeScript de docs/browser-local-storage.mjs del backend, con estas diferencias:
 *  - Las peticiones van por el proxy (mismo origen): la X-Api-Key no pasa por el navegador.
 *  - Si ya tenemos el original en el navegador se escribe desde ahí, sin volver a descargarlo.
 *  - El resumen NO se regenera al guardar (cada petición puede facturarse): se escribe el que el usuario ya generó.
 *  - Cada archivo se comprueba al terminar (tamaño en disco) antes de dar la reunión por guardada.
 * El handle de la carpeta y su ruta nunca salen del navegador.
 */

export const supportsLocalFolder = () => typeof window !== 'undefined' && window.isSecureContext && typeof window.showDirectoryPicker === 'function';

/** Llamar directamente desde un clic, antes de esperar a ninguna petición HTTP: el selector exige un gesto del usuario */
export function chooseFolder(): Promise<FileSystemDirectoryHandle> {
  if (!supportsLocalFolder()) throw new LocalSaveError('unsupported');
  return window.showDirectoryPicker!({ id: 'murmur-meetings', mode: 'readwrite', startIn: 'documents' });
}

export type FolderPermission = 'granted' | 'prompt' | 'denied';

export async function folderPermission(directory: FileSystemDirectoryHandle): Promise<FolderPermission> {
  try {
    return (await directory.queryPermission({ mode: 'readwrite' })) as FolderPermission;
  } catch {
    return 'denied';
  }
}

/** Pedir otra vez el permiso (el navegador lo olvida al reiniciar). Requiere un gesto del usuario. */
export async function renewPermission(directory: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    return (await directory.requestPermission({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

export type LocalSaveErrorCode = 'unsupported' | 'permission' | 'inactive' | 'artifact' | 'disk' | 'verify' | 'write';

export class LocalSaveError extends Error {
  readonly code: LocalSaveErrorCode;
  readonly artifact?: ArtifactKind;
  readonly status?: number;
  constructor(code: LocalSaveErrorCode, options: { artifact?: ArtifactKind; status?: number } = {}) {
    super(code);
    this.code = code;
    this.artifact = options.artifact;
    this.status = options.status;
  }
}

/** Nombre de archivo o carpeta seguro: sin rutas, sin caracteres de control, sin «.» ni «..» */
function safeName(name: string): string {
  if (!name || name === '.' || name === '..' || /[\\/:\u0000-\u001f]/.test(name)) throw new LocalSaveError('write');
  return name;
}

export interface SavedFile {
  name: string;
  bytes: number;
}

export interface SaveReceipt {
  meetingId: string;
  folderName: string;
  files: SavedFile[];
  /** Si se escribió summary.json (el resumen solo se guarda si el usuario ya lo había generado) */
  summaryIncluded: boolean;
}

interface Source {
  stream: ReadableStream<Uint8Array>;
  /** Tamaño esperado en bytes, si se conoce de antemano */
  size: number | null;
}

async function writeFile(folder: FileSystemDirectoryHandle, name: string, source: Source, kind: ArtifactKind): Promise<SavedFile> {
  const handle = await folder.getFileHandle(safeName(name), { create: true });
  const writable = await handle.createWritable();
  // pipeTo cierra el archivo solo si todo fue bien y lo aborta (sin dejar medio escrito) si algo falla
  await source.stream.pipeTo(writable);
  const written = (await handle.getFile()).size;
  if (written === 0 || (source.size != null && written !== source.size)) throw new LocalSaveError('verify', { artifact: kind });
  return { name, bytes: written };
}

const textSource = (text: string): Source => {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  return { stream: blob.stream(), size: blob.size };
};

function classify(error: unknown, artifact?: ArtifactKind): LocalSaveError {
  if (error instanceof LocalSaveError) return error;
  if (error instanceof ApiError) return new LocalSaveError('artifact', { artifact, status: error.status });
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return new LocalSaveError('permission', { artifact });
    if (error.name === 'QuotaExceededError') return new LocalSaveError('disk', { artifact });
    if (error.name === 'AbortError') throw error;
  }
  return new LocalSaveError('write', { artifact });
}

export interface SaveOptions {
  directory: FileSystemDirectoryHandle;
  manifest: LocalExportDto;
  /** Original guardado en el navegador: si existe, no se vuelve a descargar del servidor */
  localMedia?: Blob;
  /** Resumen ya generado por el usuario; si no hay, no se escribe summary.json */
  summary?: SummaryResponseDto;
  /** Texto legible del resumen (summary.txt), localizado por quien llama */
  summaryText?: (summary: SummaryResponseDto) => string;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, fileName: string) => void;
}

/** Escribe en `<carpeta elegida>/<manifest.folderName>/` todo lo disponible. No borra nada en el servidor. */
export async function saveMeetingToFolder(options: SaveOptions): Promise<SaveReceipt> {
  const { directory, manifest, localMedia, summary, summaryText, signal, onProgress } = options;
  if ((await folderPermission(directory)) !== 'granted') throw new LocalSaveError('permission');
  if (!manifest.canConfirmExport) throw new LocalSaveError('inactive');

  const artifacts = manifest.artifacts.filter((artifact) => artifact.available && (artifact.kind !== 'summary-json' || summary));
  let folder: FileSystemDirectoryHandle;
  try {
    folder = await directory.getDirectoryHandle(safeName(manifest.folderName), { create: true });
  } catch (error) {
    throw classify(error);
  }

  const files: SavedFile[] = [];
  let done = 0;
  for (const artifact of artifacts) {
    onProgress?.(done, artifacts.length, artifact.fileName);
    try {
      if (artifact.kind === 'summary-json' && summary) {
        files.push(await writeFile(folder, artifact.fileName, textSource(JSON.stringify(summary, null, 2)), artifact.kind));
        if (summaryText) files.push(await writeFile(folder, 'summary.txt', textSource(summaryText(summary)), artifact.kind));
      } else if (artifact.kind === 'recording' && localMedia) {
        files.push(await writeFile(folder, artifact.fileName, { stream: localMedia.stream(), size: localMedia.size }, artifact.kind));
      } else {
        const response = await fetchArtifact(artifact, signal);
        if (!response.body) throw new LocalSaveError('artifact', { artifact: artifact.kind, status: response.status });
        const length = Number(response.headers.get('Content-Length'));
        files.push(await writeFile(folder, artifact.fileName, { stream: response.body, size: Number.isFinite(length) && length > 0 ? length : null }, artifact.kind));
      }
    } catch (error) {
      throw classify(error, artifact.kind);
    }
    done++;
  }
  onProgress?.(done, artifacts.length, '');
  return { meetingId: manifest.meetingId, folderName: manifest.folderName, files, summaryIncluded: files.some((file) => file.name === 'summary.json') };
}

/** Alternativa sin carpeta (Firefox, Safari, HTTP): descargas normales. El navegador decide dónde caen. */
export async function downloadMeetingFiles(options: Omit<SaveOptions, 'directory'>): Promise<SaveReceipt> {
  const { manifest, localMedia, summary, summaryText, signal, onProgress } = options;
  const artifacts: LocalArtifactDto[] = manifest.artifacts.filter((artifact) => artifact.available && (artifact.kind !== 'summary-json' || summary));
  const prefix = manifest.folderName;
  const files: SavedFile[] = [];
  let done = 0;
  for (const artifact of artifacts) {
    onProgress?.(done, artifacts.length, artifact.fileName);
    try {
      if (artifact.kind === 'summary-json' && summary) {
        const json = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
        downloadBlob(json, `${prefix}-${artifact.fileName}`);
        files.push({ name: artifact.fileName, bytes: json.size });
        if (summaryText) {
          const text = new Blob([summaryText(summary)], { type: 'text/plain;charset=utf-8' });
          downloadBlob(text, `${prefix}-summary.txt`);
          files.push({ name: 'summary.txt', bytes: text.size });
        }
      } else {
        const blob = artifact.kind === 'recording' && localMedia ? localMedia : await (await fetchArtifact(artifact, signal)).blob();
        downloadBlob(blob, `${prefix}-${artifact.fileName}`);
        files.push({ name: artifact.fileName, bytes: blob.size });
      }
    } catch (error) {
      throw classify(error, artifact.kind);
    }
    done++;
    // Muchos navegadores bloquean varias descargas seguidas: se espacian
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  onProgress?.(done, artifacts.length, '');
  return { meetingId: manifest.meetingId, folderName: prefix, files, summaryIncluded: files.some((file) => file.name === 'summary.json') };
}
