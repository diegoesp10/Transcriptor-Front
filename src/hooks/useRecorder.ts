import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import * as idb from '../db/idb';
import type { RecordingSession } from '../db/model';
import { newId } from '../utils/format';
import { computePeaks, pickRecorderMime, toPeaks } from '../utils/media';

/*
 * Grabación dentro de la propia app, con un micrófono (el elegido en el selector o el predeterminado del sistema).
 * La señal pasa por un grafo Web Audio (fuente → analizador → destino) y el MediaRecorder graba el destino. Cada segundo se
 * guarda un trozo en IndexedDB: si la pestaña se cierra o el navegador falla, la grabación se recupera al volver.
 */

export type RecorderPhase = 'idle' | 'requesting' | 'recording' | 'paused';
/** Avisos que no impiden grabar: el micrófono elegido ya no estaba y se usó el predeterminado */
export type RecorderNotice = 'micFallback';
export type RecorderError = 'unsupported' | 'denied' | 'noDevice' | 'busy' | 'failed';

export interface Recording {
  blob: Blob;
  mime: string;
  durationSec: number;
  /** Picos normalizados para dibujar la onda */
  peaks: number[];
  startedAt: string;
  /** Borra la copia de seguridad por trozos. Llamar solo cuando la grabación ya está guardada en la biblioteca. */
  release: () => Promise<void>;
}

export const supportsRecording = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

class RecorderFailure extends Error {
  readonly code: RecorderError;
  constructor(code: RecorderError) {
    super(code);
    this.code = code;
  }
}

/** Número de barras de historial que dibuja la onda en vivo */
export const WAVE_HISTORY = 96;

interface Live {
  recorder: MediaRecorder;
  ctx: AudioContext;
  analyser: AnalyserNode;
  streams: MediaStream[];
  chunks: Blob[];
  writes: Promise<unknown>;
  seq: number;
  session: RecordingSession;
  levels: number[];
  startedAt: number;
  pausedAt: number | null;
  pausedTotal: number;
  raf: number;
  wake: WakeLockSentinel | null;
  discard: boolean;
  startedIso: string;
}

const elapsedOf = (live: Live, now = performance.now()) => Math.max(0, ((live.pausedAt ?? now) - live.startedAt - live.pausedTotal) / 1000);

export function useRecorder(onFinish: (recording: Recording) => void) {
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<RecorderError | null>(null);
  const [notice, setNotice] = useState<RecorderNotice | null>(null);
  const live = useRef<Live | null>(null);
  /** Nivel de entrada suavizado (0‑1) para animar sin renderizar */
  const levelRef = useRef(0);
  /** Últimos niveles (de más antiguo a más nuevo) para la onda desplazable */
  const historyRef = useRef<number[]>([]);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;

  const finalize = useCallback(async (current: Live) => {
    cancelAnimationFrame(current.raf);
    for (const stream of current.streams) for (const track of stream.getTracks()) track.stop();
    current.ctx.close().catch(() => undefined);
    current.wake?.release().catch(() => undefined);
    await current.writes;
    const durationSec = elapsedOf(current);
    const release = () => idb.clearSession(current.session.id).catch(() => undefined);
    const discarded = current.discard || current.chunks.length === 0;
    const blob = new Blob(current.chunks, { type: current.session.mime });
    // La onda se calcula del audio ya grabado: el muestreo en vivo depende de requestAnimationFrame, que el navegador
    // detiene si la pestaña pasa a segundo plano (justo lo que pasa en una reunión larga). Ese muestreo queda de respaldo.
    const peaks = discarded ? [] : ((await computePeaks(blob)) ?? toPeaks(current.levels));
    live.current = null;
    levelRef.current = 0;
    setPhase('idle');
    setElapsed(0);
    if (discarded) {
      await release();
      return;
    }
    finishRef.current({
      blob,
      mime: current.session.mime,
      durationSec,
      peaks,
      startedAt: current.startedIso,
      release,
    });
  }, []);

  const start = useCallback(
    async (language: string, micId = '') => {
      if (live.current) return;
      setError(null);
      setNotice(null);
      setPhase('requesting');
      const streams: MediaStream[] = [];
      try {
        if (!supportsRecording()) throw new RecorderFailure('unsupported');
        const processing = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
        let mic: MediaStream;
        if (micId) {
          try {
            mic = await navigator.mediaDevices.getUserMedia({ audio: { ...processing, deviceId: { exact: micId } } });
          } catch (caught) {
            // El micrófono elegido ya no está (desenchufado, otro equipo…): se graba con el predeterminado y se avisa
            const name = caught instanceof DOMException ? caught.name : '';
            if (name !== 'OverconstrainedError' && name !== 'NotFoundError') throw caught;
            mic = await navigator.mediaDevices.getUserMedia({ audio: processing });
            setNotice('micFallback');
          }
        } else {
          mic = await navigator.mediaDevices.getUserMedia({ audio: processing });
        }
        streams.push(mic);

        const ctx = new AudioContext();
        await ctx.resume();
        const source = ctx.createMediaStreamSource(mic);
        const destination = ctx.createMediaStreamDestination();
        source.connect(destination);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);

        const mime = pickRecorderMime();
        const recorder = new MediaRecorder(destination.stream, { mimeType: mime || undefined, audioBitsPerSecond: 64_000 });
        const startedIso = new Date().toISOString();
        const session: RecordingSession = { id: newId(), startedAt: startedIso, mime: recorder.mimeType || mime || 'audio/webm', language, durationSec: 0, updatedAt: Date.now() };
        // Sin almacén local la grabación funciona igual, solo que sin copia de seguridad
        const writes: Promise<unknown> = idb.putSession(session).catch(() => undefined);

        const current: Live = {
          recorder,
          ctx,
          analyser,
          streams,
          chunks: [],
          writes,
          seq: 0,
          session,
          levels: [],
          startedAt: performance.now(),
          pausedAt: null,
          pausedTotal: 0,
          raf: 0,
          wake: null,
          discard: false,
          startedIso,
        };
        live.current = current;
        historyRef.current = [];

        recorder.ondataavailable = (event) => {
          if (!event.data.size) return;
          current.chunks.push(event.data);
          const seq = current.seq++;
          current.writes = current.writes
            .then(() => idb.appendChunk(session.id, seq, event.data))
            .then(() => idb.putSession({ ...session, durationSec: elapsedOf(current), updatedAt: Date.now() }))
            .catch(() => undefined);
        };
        recorder.onstop = () => void finalize(current);
        recorder.onerror = () => setError('failed');
        // Si se desconecta el micrófono, se cierra la grabación con lo que haya
        mic.getAudioTracks()[0]?.addEventListener('ended', () => stop());
        recorder.start(1000);
        setPhase('recording');

        // Un solo bucle: nivel suavizado para la esfera, historial para la onda y muestras para la onda guardada
        const buffer = new Uint8Array(analyser.fftSize);
        let lastHistory = 0;
        let lastSample = 0;
        let peakSince = 0;
        const loop = (now: number) => {
          current.raf = requestAnimationFrame(loop);
          analyser.getByteTimeDomainData(buffer);
          let peak = 0;
          for (const value of buffer) peak = Math.max(peak, Math.abs(value - 128) / 128);
          const level = current.pausedAt == null ? Math.min(1, peak * 1.6) : 0;
          levelRef.current += (level - levelRef.current) * (level > levelRef.current ? 0.55 : 0.1);
          peakSince = Math.max(peakSince, level);
          if (now - lastHistory >= 55) {
            const history = historyRef.current;
            history.push(levelRef.current);
            if (history.length > WAVE_HISTORY) history.shift();
            lastHistory = now;
          }
          if (now - lastSample >= 100) {
            if (current.pausedAt == null) current.levels.push(peakSince);
            peakSince = 0;
            lastSample = now;
          }
        };
        current.raf = requestAnimationFrame(loop);

        // Pantalla encendida mientras se graba (si se oculta la pestaña el navegador suelta el bloqueo: se vuelve a pedir)
        const acquire = () => {
          navigator.wakeLock
            ?.request('screen')
            .then((sentinel) => {
              current.wake = sentinel;
            })
            .catch(() => undefined);
        };
        acquire();
        const onVisible = () => {
          if (document.visibilityState === 'visible' && live.current === current) acquire();
        };
        document.addEventListener('visibilitychange', onVisible);
        recorder.addEventListener('stop', () => document.removeEventListener('visibilitychange', onVisible), { once: true });
      } catch (caught) {
        for (const stream of streams) for (const track of stream.getTracks()) track.stop();
        setPhase('idle');
        if (caught instanceof RecorderFailure) return setError(caught.code);
        const name = caught instanceof DOMException ? caught.name : '';
        if (name === 'NotAllowedError' || name === 'SecurityError') return setError('denied');
        if (name === 'NotFoundError' || name === 'OverconstrainedError') return setError('noDevice');
        if (name === 'NotReadableError') return setError('busy');
        setError('failed');
      }
    },
    [finalize],
  );

  const stop = useCallback(() => {
    const current = live.current;
    if (current && current.recorder.state !== 'inactive') current.recorder.stop();
  }, []);

  const pause = useCallback(() => {
    const current = live.current;
    if (!current || current.recorder.state !== 'recording') return;
    current.recorder.pause();
    current.pausedAt = performance.now();
    setPhase('paused');
  }, []);

  const resume = useCallback(() => {
    const current = live.current;
    if (!current || current.recorder.state !== 'paused') return;
    current.recorder.resume();
    if (current.pausedAt != null) current.pausedTotal += performance.now() - current.pausedAt;
    current.pausedAt = null;
    setPhase('recording');
  }, []);

  const discard = useCallback(() => {
    const current = live.current;
    if (!current) return;
    current.discard = true;
    stop();
  }, [stop]);

  // Contador visible
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused') return;
    const timer = setInterval(() => {
      if (live.current) setElapsed(elapsedOf(live.current));
    }, 250);
    return () => clearInterval(timer);
  }, [phase]);

  // Avisa antes de cerrar la pestaña con una grabación en curso
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused') return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [phase]);

  // Si el componente se desmonta grabando, se detiene y se conserva lo grabado como recuperable
  useEffect(
    () => () => {
      const current = live.current;
      if (current) {
        cancelAnimationFrame(current.raf);
        current.recorder.onstop = null;
        if (current.recorder.state !== 'inactive') current.recorder.stop();
        for (const stream of current.streams) for (const track of stream.getTracks()) track.stop();
        current.ctx.close().catch(() => undefined);
        live.current = null;
      }
    },
    [],
  );

  return { phase, elapsed, error, notice, clearError: () => setError(null), start, stop, pause, resume, discard, levelRef: levelRef as RefObject<number>, historyRef: historyRef as RefObject<number[]> };
}
