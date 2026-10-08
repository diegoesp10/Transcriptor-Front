import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';

/**
 * Reproductor sobre un <video> (vale también para audio). `blob` es el archivo guardado en el navegador.
 * Los .webm del MediaRecorder no traen la duración en la cabecera (Infinity) y no dejan saltar: se arregla forzando al
 * elemento a recorrer el archivo una vez, y mientras tanto se usa la duración medida al grabar.
 */
export const RATES = [1, 1.25, 1.5, 2, 0.75] as const;

export function useMediaPlayer(blob: Blob | undefined, knownDuration: number | null) {
  const ref = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(knownDuration ?? 0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState<number>(1);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    setTime(0);
    setPlaying(false);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  useEffect(() => {
    if (knownDuration) setDuration((current) => (Number.isFinite(current) && current > 0 ? current : knownDuration));
  }, [knownDuration]);

  const onLoadedMetadata = useCallback(
    (event: SyntheticEvent<HTMLVideoElement>) => {
      const element = event.currentTarget;
      if (element.duration === Infinity) {
        const settle = () => {
          element.removeEventListener('timeupdate', settle);
          element.currentTime = 0;
          if (Number.isFinite(element.duration)) setDuration(element.duration);
        };
        element.addEventListener('timeupdate', settle);
        element.currentTime = 1e101;
      } else if (Number.isFinite(element.duration)) {
        setDuration(element.duration);
      }
    },
    [],
  );

  const seek = useCallback((seconds: number, play = false) => {
    const element = ref.current;
    if (!element) return;
    element.currentTime = Math.max(0, seconds);
    setTime(element.currentTime);
    if (play) void element.play().catch(() => undefined);
  }, []);

  const toggle = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => undefined);
    else element.pause();
  }, []);

  const skip = useCallback((delta: number) => {
    const element = ref.current;
    if (element) seek(element.currentTime + delta);
  }, [seek]);

  const cycleRate = useCallback(() => {
    const element = ref.current;
    const next = RATES[(RATES.indexOf(rate as (typeof RATES)[number]) + 1) % RATES.length];
    setRate(next);
    if (element) element.playbackRate = next;
  }, [rate]);

  /** Propiedades para el <video>: se esparcen en el elemento que dibuja el componente del reproductor */
  const mediaProps = {
    ref,
    src: url ?? undefined,
    preload: 'metadata' as const,
    playsInline: true,
    onLoadedMetadata,
    onTimeUpdate: (event: SyntheticEvent<HTMLVideoElement>) => {
      if (Number.isFinite(event.currentTarget.currentTime)) setTime(event.currentTarget.currentTime);
    },
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
  };

  return { mediaProps, available: Boolean(url), time, duration, playing, rate, seek, toggle, skip, cycleRate };
}

export type MediaPlayerState = ReturnType<typeof useMediaPlayer>;
