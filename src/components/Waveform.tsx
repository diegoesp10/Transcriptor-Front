import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { toPeaks } from '../utils/media';

interface Props {
  /** Picos normalizados 0‑1. Si es null se dibuja una barra de progreso lisa. */
  peaks: number[] | null;
  /** 0‑1 */
  progress?: number;
  /** Con onSeek la onda se puede arrastrar y recorrer con el teclado */
  onSeek?: (fraction: number) => void;
  label?: string;
  className?: string;
}

/** Onda de audio: barras redondeadas con la parte reproducida en color. Sirve de mapa y de control de posición. */
export function Waveform({ peaks, progress = 0, onSeek, label, className = '' }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [width, setWidth] = useState(0);

  // Se dibuja una barra de ~4 px por cada 4 px de ancho: los picos se remuestrean al tamaño real de la onda
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);
  const shown = useMemo(() => (peaks && width > 0 ? toPeaks(peaks, Math.max(8, Math.floor(width / 4))) : null), [peaks, width]);

  const fractionAt = (event: PointerEvent) => {
    const rect = box.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  };
  const onDown = (event: PointerEvent) => {
    if (!onSeek) return;
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    onSeek(fractionAt(event));
  };
  const onMove = (event: PointerEvent) => {
    if (dragging.current && onSeek) onSeek(fractionAt(event));
  };
  const onUp = () => {
    dragging.current = false;
  };
  const onKey = (event: KeyboardEvent) => {
    if (!onSeek) return;
    if (event.key === 'ArrowRight') onSeek(Math.min(1, progress + 0.02));
    else if (event.key === 'ArrowLeft') onSeek(Math.max(0, progress - 0.02));
    else return;
    event.preventDefault();
  };

  const clip: CSSProperties = { clipPath: `inset(0 ${(1 - Math.min(1, Math.max(0, progress))) * 100}% 0 0)` };
  const heightOf = (peak: number) => `${Math.max(10, peak * 100)}%`;
  const bars = shown?.map((peak, index) => <i key={index} style={{ height: heightOf(peak) }} />);

  return (
    <div
      ref={box}
      className={`wave ${onSeek ? 'is-seekable' : ''} ${peaks ? '' : 'wave-plain'} ${className}`}
      role={onSeek ? 'slider' : 'img'}
      aria-label={label}
      aria-valuemin={onSeek ? 0 : undefined}
      aria-valuemax={onSeek ? 100 : undefined}
      aria-valuenow={onSeek ? Math.round(progress * 100) : undefined}
      tabIndex={onSeek ? 0 : undefined}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onKeyDown={onKey}
    >
      <div className="wave-bars">{bars}</div>
      <div className="wave-bars wave-bars-played" style={clip} aria-hidden>
        {bars}
      </div>
      {!peaks && <div className="wave-fill" style={{ width: `${progress * 100}%` }} />}
    </div>
  );
}
