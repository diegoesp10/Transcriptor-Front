import type { JobStatus } from '../api/types';

/**
 * Estado de un elemento de la biblioteca.
 *  local        guardado en este navegador, todavía sin enviar al servidor
 *  uploading    subiendo
 *  uploadFailed la subida falló (se puede reintentar: el archivo sigue guardado aquí)
 *  Queued…      estados del servidor (Domain.JobStatus)
 */
export type ItemStatus = 'local' | 'uploading' | 'uploadFailed' | JobStatus;

export interface LibraryItem {
  /** Id local (la API no lista reuniones, así que la biblioteca vive en este navegador) */
  id: string;
  /** Título que ve el usuario (editable) */
  name: string;
  /** Nombre de archivo que se envía al servidor (con una extensión admitida por el backend) */
  fileName: string;
  /** recording: grabado en la app · upload: archivo subido por el usuario · remote: abierto por id de reunión, sin archivo local */
  source: 'recording' | 'upload' | 'remote';
  kind: 'audio' | 'video';
  mime: string;
  size: number;
  durationSec: number | null;
  createdAt: string;
  /** ISO 639-1 de dos letras, como exige el backend */
  language: string;
  /** Picos normalizados (0‑1) para dibujar la onda; null si no se pudieron calcular */
  peaks: number[] | null;
  /** true si el archivo está guardado en este navegador */
  hasMedia: boolean;
  /** Id de la reunión en el servidor, una vez subida */
  meetingId: string | null;
  status: ItemStatus;
  completedChunks: number;
  totalChunks: number;
  errorCode: string | null;
  /** Explicación controlada del fallo que da el servidor (en español) */
  errorMessage: string | null;
  /** Reintentos ya consumidos en el servidor */
  retryCount: number;
  /** Caducidad de la copia temporal del servidor (null si el servidor no la informa) */
  temporaryExpiresAt: string | null;
  /** Guardado en la carpeta local: cuándo, dónde y qué archivos. null si todavía no. */
  savedLocally: SavedLocally | null;
  /** present: el servidor aún tiene el original y la transcripción · deleted: se eliminaron tras confirmar el guardado */
  serverCopy: 'present' | 'deleted';
  /** Nombres asignados por el usuario a las etiquetas de hablante ("Hablante 1" → "Marta"). Solo local. */
  speakerNames: Record<string, string>;
}

export interface SavedLocally {
  at: string;
  /** Subcarpeta dentro de la carpeta elegida: meeting-{id} */
  folderName: string;
  /** Nombre de la carpeta raíz elegida por el usuario (el navegador solo da el nombre, no la ruta). null: se guardó con descargas. */
  rootName: string | null;
  files: string[];
  summaryIncluded: boolean;
}

/** Grabación en curso: se persiste por trozos para poder recuperarla si la pestaña se cierra o falla */
export interface RecordingSession {
  id: string;
  startedAt: string;
  mime: string;
  language: string;
  durationSec: number;
  /** Date.now() del último trozo guardado: una sesión sin actividad reciente es una grabación interrumpida */
  updatedAt: number;
}
