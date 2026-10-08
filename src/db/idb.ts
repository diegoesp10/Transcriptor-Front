import type { SummaryResponseDto, TranscriptDto } from '../api/types';
import type { LibraryItem, RecordingSession } from './model';

/*
 * Almacén local (IndexedDB). Todo el audio/vídeo y las transcripciones en caché se quedan en este navegador:
 *   items        LibraryItem (metadatos)
 *   summaries    resumen con IA generado a petición, clave = id del item
 *   folders      handle de la carpeta local elegida (FileSystemDirectoryHandle: se puede guardar en IndexedDB)
 *   blobs        archivo original / grabación, clave = id del item
 *   transcripts  TranscriptDto en caché, clave = id del item
 *   sessions     grabaciones en curso (para recuperarlas)
 *   chunks       trozos de cada grabación en curso, clave [session, seq]
 */

const NAME = 'murmur';
const VERSION = 2;
type Store = 'items' | 'blobs' | 'transcripts' | 'sessions' | 'chunks' | 'summaries' | 'folders';

let opened: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion < 1) {
        db.createObjectStore('items', { keyPath: 'id' });
        db.createObjectStore('blobs');
        db.createObjectStore('transcripts');
        db.createObjectStore('sessions', { keyPath: 'id' });
        db.createObjectStore('chunks', { keyPath: ['session', 'seq'] });
      }
      if (event.oldVersion < 2) {
        db.createObjectStore('summaries');
        db.createObjectStore('folders');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      opened = null;
      reject(request.error);
    };
  });
  return opened;
}

/** Ejecuta una operación y espera a que la transacción termine de verdad (no solo a que la petición responda) */
async function run<T>(stores: Store | Store[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const request = work(tx);
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// ── Biblioteca ────────────────────────────────────────────────────────────────

export const loadItems = () => run<LibraryItem[]>('items', 'readonly', (tx) => tx.objectStore('items').getAll());

export const saveItem = (item: LibraryItem) => run('items', 'readwrite', (tx) => tx.objectStore('items').put(item)).then(() => undefined);

export async function deleteItem(id: string): Promise<void> {
  await run(['items', 'blobs', 'transcripts', 'summaries'], 'readwrite', (tx) => {
    tx.objectStore('blobs').delete(id);
    tx.objectStore('transcripts').delete(id);
    tx.objectStore('summaries').delete(id);
    return tx.objectStore('items').delete(id);
  });
}

export const saveBlob = (id: string, blob: Blob) => run('blobs', 'readwrite', (tx) => tx.objectStore('blobs').put(blob, id)).then(() => undefined);

export const loadBlob = (id: string) => run<Blob | undefined>('blobs', 'readonly', (tx) => tx.objectStore('blobs').get(id));

export const saveTranscript = (id: string, dto: TranscriptDto) =>
  run('transcripts', 'readwrite', (tx) => tx.objectStore('transcripts').put(dto, id)).then(() => undefined);

export const loadTranscript = (id: string) =>
  run<TranscriptDto | undefined>('transcripts', 'readonly', (tx) => tx.objectStore('transcripts').get(id));

export const deleteTranscript = (id: string) =>
  run('transcripts', 'readwrite', (tx) => tx.objectStore('transcripts').delete(id)).then(() => undefined);

export const saveSummary = (id: string, summary: SummaryResponseDto) =>
  run('summaries', 'readwrite', (tx) => tx.objectStore('summaries').put(summary, id)).then(() => undefined);

export const loadSummary = (id: string) =>
  run<SummaryResponseDto | undefined>('summaries', 'readonly', (tx) => tx.objectStore('summaries').get(id));

// ── Carpeta local (un solo destino por navegador; cuando haya usuarios, la clave será el usuario) ───────

const FOLDER_KEY = 'default';

export const saveFolder = (handle: FileSystemDirectoryHandle) =>
  run('folders', 'readwrite', (tx) => tx.objectStore('folders').put(handle, FOLDER_KEY)).then(() => undefined);

export const loadFolder = () =>
  run<FileSystemDirectoryHandle | undefined>('folders', 'readonly', (tx) => tx.objectStore('folders').get(FOLDER_KEY));

export const deleteFolder = () => run('folders', 'readwrite', (tx) => tx.objectStore('folders').delete(FOLDER_KEY)).then(() => undefined);

// ── Grabaciones en curso ──────────────────────────────────────────────────────

export const putSession = (session: RecordingSession) =>
  run('sessions', 'readwrite', (tx) => tx.objectStore('sessions').put(session)).then(() => undefined);

export const listSessions = () => run<RecordingSession[]>('sessions', 'readonly', (tx) => tx.objectStore('sessions').getAll());

export const appendChunk = (session: string, seq: number, blob: Blob) =>
  run('chunks', 'readwrite', (tx) => tx.objectStore('chunks').put({ session, seq, blob })).then(() => undefined);

export async function loadChunks(session: string): Promise<Blob[]> {
  const rows = await run<{ seq: number; blob: Blob }[]>('chunks', 'readonly', (tx) =>
    tx.objectStore('chunks').getAll(IDBKeyRange.bound([session, 0], [session, Number.MAX_SAFE_INTEGER])),
  );
  return rows.sort((a, b) => a.seq - b.seq).map((row) => row.blob);
}

export async function clearSession(id: string): Promise<void> {
  await run(['sessions', 'chunks'], 'readwrite', (tx) => {
    tx.objectStore('chunks').delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
    return tx.objectStore('sessions').delete(id);
  });
}

// ── Mantenimiento ─────────────────────────────────────────────────────────────

export async function clearAll(): Promise<void> {
  // La carpeta elegida no se borra aquí: es una preferencia del usuario, con su propio botón en Ajustes
  const stores: Store[] = ['items', 'blobs', 'transcripts', 'sessions', 'summaries', 'chunks'];
  await run(stores, 'readwrite', (tx) => {
    for (const store of stores.slice(0, -1)) tx.objectStore(store).clear();
    return tx.objectStore('chunks').clear();
  });
}

/** Uso y cuota de almacenamiento del navegador (no existe en todos los navegadores) */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const { usage, quota } = await navigator.storage.estimate();
    return usage != null && quota != null ? { usage, quota } : null;
  } catch {
    return null;
  }
}

/** Pide al navegador que no borre estos datos al liberar espacio (el audio es el único original) */
export async function requestPersistence(): Promise<void> {
  try {
    await navigator.storage.persist();
  } catch {
    /* no disponible */
  }
}
