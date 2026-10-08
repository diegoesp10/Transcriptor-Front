import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, confirmLocalExport, currentPause, generateSummary, getLocalExport, getMeeting, getTranscript, retryMeeting, uploadMeeting } from '../api/client';
import type { MeetingStatusDto, SummaryResponseDto, TranscriptDto } from '../api/types';
import * as idb from '../db/idb';
import type { LibraryItem } from '../db/model';
import { useI18n } from '../i18n';
import { usePrefs } from '../hooks/usePrefs';
import { downloadMeetingFiles, LocalSaveError, saveMeetingToFolder, type SaveReceipt } from '../local/folder';
import { apiErrorText, localSaveErrorText } from '../utils/errors';
import { summaryToText } from '../utils/exporters';
import { newId, stamp } from '../utils/format';
import { computePeaks, extensionForMime, kindOf, serverFileName, stripExtension } from '../utils/media';
import { useFolder } from './folder';
import { useToasts } from './toasts';

/*
 * Biblioteca local + orquestación contra la API.
 * La API no lista reuniones, así que cada elemento se guarda en IndexedDB con su `meetingId`. Este contexto:
 *  - guarda el archivo y lo sube (máx. 2 a la vez, con progreso y cancelación),
 *  - consulta el estado de los trabajos en curso cada pocos segundos y cachea la transcripción al completarse,
 *  - recupera las grabaciones que quedaron a medias si la pestaña se cerró.
 */

export interface NewMedia {
  blob: Blob;
  /** Título visible */
  title: string;
  source: 'recording' | 'upload';
  /** Nombre de archivo original (subidas) o con extensión deducida del formato (grabaciones) */
  fileName: string;
  language: string;
  durationSec: number | null;
  peaks: number[] | null;
}

interface Library {
  items: LibraryItem[];
  ready: boolean;
  /** Fracción 0‑1 de subida por id de item */
  progress: Record<string, number>;
  addMedia: (media: NewMedia, transcribe: boolean) => Promise<LibraryItem>;
  transcribe: (id: string) => void;
  cancelUpload: (id: string) => void;
  retry: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, name: string) => void;
  setLanguage: (id: string, language: string) => void;
  setSpeakerName: (id: string, speaker: string, name: string) => void;
  getBlob: (id: string) => Promise<Blob | undefined>;
  getTranscript: (id: string) => Promise<TranscriptDto | undefined>;
  openRemote: (meetingId: string) => Promise<LibraryItem>;
  clearEverything: () => Promise<void>;
  /** Guardado en curso por id de item (archivo a archivo) */
  saving: Record<string, { done: number; total: number; file: string }>;
  /** Resumen con IA ya generado (caché local) */
  getSummary: (id: string) => Promise<SummaryResponseDto | undefined>;
  /** Genera el resumen con el modelo local del servidor (tarda minutos, uno a la vez) y lo guarda en el navegador */
  requestSummary: (id: string) => Promise<SummaryResponseDto>;
  /** Escribe original, transcripción y resumen (si existe) en la carpeta local elegida */
  saveLocally: (id: string) => Promise<SaveReceipt>;
  /** Alternativa sin carpeta: descargas normales del navegador */
  downloadFiles: (id: string) => Promise<SaveReceipt>;
  /** Elimina de verdad la copia del servidor. Solo después de guardar. Irreversible. */
  confirmServerDelete: (id: string) => Promise<void>;
}

const LibraryContext = createContext<Library | null>(null);

/*
 * Límites del servidor (RequestLimits, por IP): una subida simultánea y 3 por minuto; 60 lecturas por minuto por endpoint,
 * contando todas las reuniones juntas (GET /api/meetings/{id} es un único endpoint). Pasarse devuelve 429 y, si se repite,
 * bloquea la IP. Aquí se va por debajo con margen.
 */
const MAX_PARALLEL_UPLOADS = 1;
const UPLOADS_PER_MINUTE = 3;
/** Pausa mínima entre rondas de sondeo y tiempo por reunión activa: ≤ 24 consultas de estado por minuto con cualquier número de trabajos */
const POLL_MIN_MS = 3000;
const POLL_PER_JOB_MS = 2500;
const ACTIVE = new Set(['Queued', 'Processing']);
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isGuid = (value: string) => GUID.test(value.trim());

/** Una subida o un trabajo del servidor sin terminar */
export const isBusy = (item: LibraryItem) => item.status === 'uploading' || item.status === 'Queued' || item.status === 'Processing';

function fromServer(dto: MeetingStatusDto): Pick<LibraryItem, 'status' | 'completedChunks' | 'totalChunks' | 'errorCode' | 'errorMessage' | 'retryCount' | 'meetingId' | 'temporaryExpiresAt'> {
  return {
    status: dto.status,
    completedChunks: dto.completedChunks,
    totalChunks: dto.totalChunks,
    errorCode: dto.errorCode,
    errorMessage: dto.errorMessage ?? null,
    retryCount: dto.retryCount ?? 0,
    meetingId: dto.id,
    temporaryExpiresAt: dto.temporaryExpiresAt ?? null,
  };
}

/** Milisegundos que quedan de la pausa impuesta por el servidor (0 si no hay) */
const pauseLeft = () => Math.max(0, (currentPause()?.until ?? 0) - Date.now());

export function LibraryProvider({ children }: { children: ReactNode }) {
  const { t, locale } = useI18n();
  const toast = useToasts();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState<Record<string, number>>({});

  // Valores que las funciones asíncronas necesitan siempre al día sin recrearse
  const itemsRef = useRef<LibraryItem[]>([]);
  const tRef = useRef(t);
  tRef.current = t;

  const commit = useCallback((next: LibraryItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const patch = useCallback(
    (id: string, changes: Partial<LibraryItem>): LibraryItem | undefined => {
      const current = itemsRef.current.find((item) => item.id === id);
      if (!current) return undefined;
      const updated = { ...current, ...changes };
      commit(itemsRef.current.map((item) => (item.id === id ? updated : item)));
      idb.saveItem(updated).catch((error) => console.warn('No se pudo guardar el elemento', error));
      return updated;
    },
    [commit],
  );

  // ── Altas ───────────────────────────────────────────────────────────────────

  const create = useCallback(
    async (media: NewMedia): Promise<LibraryItem> => {
      const item: LibraryItem = {
        id: newId(),
        name: media.title,
        fileName: media.fileName,
        source: media.source,
        kind: kindOf(media.fileName, media.blob.type),
        mime: media.blob.type,
        size: media.blob.size,
        durationSec: media.durationSec,
        createdAt: new Date().toISOString(),
        language: media.language,
        peaks: media.peaks,
        hasMedia: true,
        temporaryExpiresAt: null,
        savedLocally: null,
        serverCopy: 'present',
        meetingId: null,
        status: 'local',
        completedChunks: 0,
        totalChunks: 0,
        errorCode: null,
        errorMessage: null,
        retryCount: 0,
        speakerNames: {},
      };
      await idb.saveBlob(item.id, media.blob);
      await idb.saveItem(item);
      commit([item, ...itemsRef.current]);
      return item;
    },
    [commit],
  );

  // ── Subidas ─────────────────────────────────────────────────────────────────

  const queue = useRef<string[]>([]);
  const active = useRef(new Map<string, AbortController>());
  const pumpRef = useRef<() => void>(() => undefined);

  const runUpload = useCallback(
    async (id: string, controller: AbortController) => {
      const item = itemsRef.current.find((candidate) => candidate.id === id);
      const blob = item ? await idb.loadBlob(id).catch(() => undefined) : undefined;
      if (!item || !blob) {
        patch(id, { status: 'uploadFailed' });
        toast.push('error', tRef.current('errors.mediaMissing'));
        return;
      }
      try {
        const dto = await uploadMeeting(blob, item.fileName, item.language, (fraction) => setProgress((all) => ({ ...all, [id]: fraction })), controller.signal);
        patch(id, fromServer(dto));
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          patch(id, { status: 'local' });
        } else {
          patch(id, { status: 'uploadFailed' });
          toast.push('error', `${item.name}: ${apiErrorText(error, tRef.current)}`);
        }
      } finally {
        setProgress(({ [id]: _done, ...rest }) => rest);
      }
    },
    [patch, toast],
  );

  /** Inicio de las subidas del último minuto, para no pasar de UPLOADS_PER_MINUTE */
  const uploadStarts = useRef<number[]>([]);
  const pumpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pump = useCallback(() => {
    if (pumpTimer.current) {
      clearTimeout(pumpTimer.current);
      pumpTimer.current = null;
    }
    while (active.current.size < MAX_PARALLEL_UPLOADS && queue.current.length > 0) {
      // Si el servidor pidió esperar o ya van 3 subidas este minuto, se espera en la cola en vez de provocar un 429
      const now = Date.now();
      uploadStarts.current = uploadStarts.current.filter((at) => now - at < 60_000);
      const wait = Math.max(pauseLeft(), uploadStarts.current.length >= UPLOADS_PER_MINUTE ? uploadStarts.current[0] + 60_000 - now + 250 : 0);
      if (wait > 0) {
        pumpTimer.current = setTimeout(() => pumpRef.current(), wait);
        return;
      }
      uploadStarts.current.push(now);
      const id = queue.current.shift()!;
      // Se registra antes de empezar para que el límite de subidas simultáneas sea exacto
      const controller = new AbortController();
      active.current.set(id, controller);
      void runUpload(id, controller).finally(() => {
        active.current.delete(id);
        pumpRef.current();
      });
    }
  }, [runUpload]);

  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

  const transcribe = useCallback(
    (id: string) => {
      const item = itemsRef.current.find((candidate) => candidate.id === id);
      if (!item || !item.hasMedia || queue.current.includes(id) || active.current.has(id)) return;
      if (item.status !== 'local' && item.status !== 'uploadFailed') return;
      patch(id, { status: 'uploading', errorCode: null });
      setProgress((all) => ({ ...all, [id]: 0 }));
      queue.current.push(id);
      pump();
    },
    [patch, pump],
  );

  const cancelUpload = useCallback(
    (id: string) => {
      const controller = active.current.get(id);
      if (controller) {
        controller.abort();
        return;
      }
      queue.current = queue.current.filter((queued) => queued !== id);
      setProgress(({ [id]: _done, ...rest }) => rest);
      patch(id, { status: 'local' });
    },
    [patch],
  );

  const addMedia = useCallback(
    async (media: NewMedia, shouldTranscribe: boolean) => {
      const item = await create(media);
      if (shouldTranscribe) transcribe(item.id);
      return item;
    },
    [create, transcribe],
  );

  // ── Acciones sobre un elemento ──────────────────────────────────────────────

  const retry = useCallback(
    async (id: string) => {
      const item = itemsRef.current.find((candidate) => candidate.id === id);
      if (!item) return;
      if (item.status === 'uploadFailed') return transcribe(id);
      if (item.status !== 'Failed' || !item.meetingId) return;
      try {
        await retryMeeting(item.meetingId);
        patch(id, { status: 'Queued', completedChunks: 0, totalChunks: 0, errorCode: null, errorMessage: null, retryCount: item.retryCount + 1 });
        await idb.deleteTranscript(id).catch(() => undefined);
      } catch (error) {
        toast.push('error', apiErrorText(error, tRef.current));
      }
    },
    [patch, toast, transcribe],
  );

  const remove = useCallback(
    async (id: string) => {
      active.current.get(id)?.abort();
      queue.current = queue.current.filter((queued) => queued !== id);
      commit(itemsRef.current.filter((item) => item.id !== id));
      await idb.deleteItem(id);
    },
    [commit],
  );

  const rename = useCallback((id: string, name: string) => {
    const clean = name.trim();
    if (clean) patch(id, { name: clean.slice(0, 150) });
  }, [patch]);

  const setLanguage = useCallback((id: string, language: string) => {
    patch(id, { language });
  }, [patch]);

  const setSpeakerName = useCallback(
    (id: string, speaker: string, name: string) => {
      const item = itemsRef.current.find((candidate) => candidate.id === id);
      if (!item) return;
      const names = { ...item.speakerNames };
      if (name.trim()) names[speaker] = name.trim().slice(0, 60);
      else delete names[speaker];
      patch(id, { speakerNames: names });
    },
    [patch],
  );

  const getBlob = useCallback((id: string) => idb.loadBlob(id).catch(() => undefined), []);

  const getTranscriptFor = useCallback(
    async (id: string): Promise<TranscriptDto | undefined> => {
      const cached = await idb.loadTranscript(id).catch(() => undefined);
      if (cached) return cached;
      const item = itemsRef.current.find((candidate) => candidate.id === id);
      if (!item?.meetingId || item.status !== 'Completed') return undefined;
      const dto = await getTranscript(item.meetingId);
      idb.saveTranscript(id, dto).catch(() => undefined);
      return dto;
    },
    [],
  );

  // ── Carpeta local, resumen y borrado de la copia del servidor ───────────────

  const folder = useFolder();
  const folderRef = useRef(folder);
  folderRef.current = folder;
  const { prefs } = usePrefs();
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const [saving, setSaving] = useState<Record<string, { done: number; total: number; file: string }>>({});

  const getSummary = useCallback((id: string) => idb.loadSummary(id).catch(() => undefined), []);

  const requestSummary = useCallback(
    async (id: string): Promise<SummaryResponseDto> => {
      const item = itemsRef.current.find((candidate) => candidate.id === id);
      if (!item?.meetingId || item.serverCopy === 'deleted') throw new LocalSaveError('inactive');
      const summary = await generateSummary(item.meetingId);
      await idb.saveSummary(id, summary);
      return summary;
    },
    [],
  );

  /** Reúne lo necesario para guardar: manifiesto del servidor, original local y resumen ya generado. La transcripción se cachea antes. */
  const prepareSave = useCallback(
    async (id: string) => {
      const item = itemsRef.current.find((candidate) => candidate.id === id);
      if (!item?.meetingId || item.status !== 'Completed' || item.serverCopy === 'deleted') throw new LocalSaveError('inactive');
      // Sin la transcripción en caché local no se debe poder borrar nada del servidor
      if (!(await getTranscriptFor(id))) throw new LocalSaveError('inactive');
      const manifest = await getLocalExport(item.meetingId);
      const localMedia = item.hasMedia ? await idb.loadBlob(id).catch(() => undefined) : undefined;
      const summary = await idb.loadSummary(id).catch(() => undefined);
      return { manifest, localMedia, summary };
    },
    [getTranscriptFor],
  );

  const recordSaved = useCallback(
    (id: string, receipt: SaveReceipt, rootName: string | null) => {
      patch(id, {
        savedLocally: { at: new Date().toISOString(), folderName: receipt.folderName, rootName, files: receipt.files.map((file) => file.name), summaryIncluded: receipt.summaryIncluded },
      });
    },
    [patch],
  );

  const onProgress = useCallback((id: string) => (done: number, total: number, file: string) => setSaving((all) => ({ ...all, [id]: { done, total, file } })), []);
  const clearSaving = useCallback((id: string) => setSaving(({ [id]: _done, ...rest }) => rest), []);

  const saveLocally = useCallback(
    async (id: string): Promise<SaveReceipt> => {
      const directory = folderRef.current.handle;
      if (!directory) throw new LocalSaveError('unsupported');
      const { manifest, localMedia, summary } = await prepareSave(id);
      setSaving((all) => ({ ...all, [id]: { done: 0, total: 0, file: '' } }));
      try {
        const receipt = await saveMeetingToFolder({ directory, manifest, localMedia, summary, summaryText: (response) => summaryToText(response, tRef.current), onProgress: onProgress(id) });
        recordSaved(id, receipt, directory.name);
        return receipt;
      } finally {
        clearSaving(id);
      }
    },
    [prepareSave, onProgress, recordSaved, clearSaving],
  );

  const downloadFiles = useCallback(
    async (id: string): Promise<SaveReceipt> => {
      const { manifest, localMedia, summary } = await prepareSave(id);
      setSaving((all) => ({ ...all, [id]: { done: 0, total: 0, file: '' } }));
      try {
        const receipt = await downloadMeetingFiles({ manifest, localMedia, summary, summaryText: (response) => summaryToText(response, tRef.current), onProgress: onProgress(id) });
        recordSaved(id, receipt, null);
        return receipt;
      } finally {
        clearSaving(id);
      }
    },
    [prepareSave, onProgress, recordSaved, clearSaving],
  );

  const confirmServerDelete = useCallback(
    async (id: string) => {
      const item = itemsRef.current.find((candidate) => candidate.id === id);
      if (!item?.meetingId || !item.savedLocally) throw new LocalSaveError('inactive');
      // Última comprobación antes de un borrado irreversible: la transcripción tiene que estar en este navegador
      if (!(await getTranscriptFor(id))) throw new LocalSaveError('inactive');
      await confirmLocalExport(item.meetingId);
      patch(id, { serverCopy: 'deleted', temporaryExpiresAt: null });
    },
    [getTranscriptFor, patch],
  );

  /** Al terminar una transcripción: si hay carpeta con permiso y el usuario lo tiene activado, se guarda sola. Borrar nunca es automático. */
  const autoSave = useCallback(
    async (id: string, name: string) => {
      const current = folderRef.current;
      if (!prefsRef.current.autoSaveLocal || !current.handle || current.permission !== 'granted') return;
      try {
        await saveLocally(id);
        toast.push('success', tRef.current('local.autoSaved', { name, folder: current.name ?? '' }));
      } catch (error) {
        toast.push('error', `${name}: ${localSaveErrorText(error, tRef.current)}`);
      }
    },
    [saveLocally, toast],
  );

  const openRemote = useCallback(
    async (meetingId: string): Promise<LibraryItem> => {
      const clean = meetingId.trim().toLowerCase();
      const existing = itemsRef.current.find((item) => item.meetingId === clean);
      if (existing) return existing;
      const dto = await getMeeting(clean);
      const item: LibraryItem = {
        id: newId(),
        name: stripExtension(dto.fileName) || stamp(new Date(dto.createdAt), locale),
        fileName: dto.fileName,
        source: 'remote',
        kind: kindOf(dto.fileName, ''),
        mime: '',
        size: 0,
        durationSec: null,
        createdAt: dto.createdAt,
        language: dto.language,
        peaks: null,
        hasMedia: false,
        savedLocally: null,
        serverCopy: 'present',
        speakerNames: {},
        ...fromServer(dto),
      };
      await idb.saveItem(item);
      commit([item, ...itemsRef.current]);
      return item;
    },
    [commit, locale],
  );

  const clearEverything = useCallback(async () => {
    for (const controller of active.current.values()) controller.abort();
    queue.current = [];
    await idb.clearAll();
    commit([]);
  }, [commit]);

  // ── Arranque: cargar, normalizar y recuperar grabaciones interrumpidas ─────

  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      try {
        const stored = await idb.loadItems();
        // Una subida que estaba en marcha al cerrar la pestaña no continúa: queda lista para reintentar
        const fixed = stored.map((raw): LibraryItem => {
          // Elementos guardados antes de existir la carpeta local: se rellenan los campos nuevos
          const item: LibraryItem = {
            ...raw,
            temporaryExpiresAt: raw.temporaryExpiresAt ?? null,
            savedLocally: raw.savedLocally ?? null,
            serverCopy: raw.serverCopy ?? 'present',
            errorMessage: raw.errorMessage ?? null,
            retryCount: raw.retryCount ?? 0,
          };
          return item.status === 'uploading' ? { ...item, status: 'uploadFailed' } : item;
        });
        for (const item of fixed) if (item.status === 'uploadFailed') idb.saveItem(item).catch(() => undefined);
        commit(fixed.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));

        for (const session of await idb.listSessions()) {
          if (Date.now() - session.updatedAt < 20_000) continue; // puede ser una grabación viva en otra pestaña
          const chunks = await idb.loadChunks(session.id);
          if (chunks.length > 0) {
            const blob = new Blob(chunks, { type: session.mime });
            await create({
              blob,
              title: `${tRef.current('recorder.recoveredName')} ${stamp(new Date(session.startedAt), locale)}`,
              source: 'recording',
              fileName: serverFileName('recording', extensionForMime(session.mime)),
              language: session.language,
              durationSec: session.durationSec || null,
              peaks: await computePeaks(blob),
            });
            toast.push('info', tRef.current('recorder.recovered'));
          }
          await idb.clearSession(session.id);
        }
      } catch (error) {
        console.warn('No se pudo abrir el almacén local', error);
        toast.push('error', tRef.current('errors.storage'));
      } finally {
        setReady(true);
        idb.requestPersistence();
      }
    })();
  }, [commit, create, locale, toast]);

  // ── Sondeo del estado de los trabajos en el servidor ───────────────────────

  const hasActiveJobs = items.some((item) => item.meetingId && ACTIVE.has(item.status));
  useEffect(() => {
    if (!hasActiveJobs) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const activeJobs = () => itemsRef.current.filter((candidate) => candidate.meetingId && ACTIVE.has(candidate.status));

    // Cada ronda consulta todos los trabajos y espera más cuantos más haya, así el ritmo total por minuto no crece
    const schedule = () => {
      if (stopped) return;
      const base = Math.max(POLL_MIN_MS, activeJobs().length * POLL_PER_JOB_MS);
      const delay = Math.max(document.hidden ? base * 4 : base, pauseLeft() + 250); // pestaña oculta: cuatro veces más despacio
      timer = setTimeout(() => void round(), delay);
    };

    const round = async () => {
      try {
        for (const item of activeJobs()) {
          if (stopped || currentPause()) break;
          try {
            const dto = await getMeeting(item.meetingId!);
            if (dto.status === 'Completed') {
              const transcript = await getTranscript(dto.id).catch(() => undefined);
              if (transcript) await idb.saveTranscript(item.id, transcript).catch(() => undefined);
              patch(item.id, fromServer(dto));
              toast.push('success', tRef.current('library.ready', { name: item.name }));
              void autoSave(item.id, item.name);
            } else {
              patch(item.id, fromServer(dto));
            }
          } catch (error) {
            // 404: el servidor ya no conoce esta reunión (p. ej. base de datos reiniciada). Sin red: se reintenta solo.
            if (error instanceof ApiError && error.status === 404) {
              patch(item.id, item.hasMedia ? { status: 'uploadFailed', meetingId: null } : { status: 'Failed', errorCode: 'NotFound' });
            }
          }
        }
      } finally {
        schedule();
      }
    };

    void round();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [hasActiveJobs, patch, toast, autoSave]);

  const value = useMemo<Library>(
    () => ({
      items,
      ready,
      progress,
      addMedia,
      transcribe,
      cancelUpload,
      retry,
      remove,
      rename,
      setLanguage,
      setSpeakerName,
      getBlob,
      getTranscript: getTranscriptFor,
      saving,
      getSummary,
      requestSummary,
      saveLocally,
      downloadFiles,
      confirmServerDelete,
      openRemote,
      clearEverything,
    }),
    [items, ready, progress, saving, addMedia, transcribe, cancelUpload, retry, remove, rename, setLanguage, setSpeakerName, getBlob, getTranscriptFor, getSummary, requestSummary, saveLocally, downloadFiles, confirmServerDelete, openRemote, clearEverything],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): Library {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary debe usarse dentro de <LibraryProvider>');
  return ctx;
}

export function useItem(id: string | undefined): LibraryItem | undefined {
  const { items } = useLibrary();
  return id ? items.find((item) => item.id === id) : undefined;
}
