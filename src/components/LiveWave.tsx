import { useEffect, useRef, type RefObject } from 'react';
import { WAVE_HISTORY } from '../hooks/useRecorder';

interface Props {
  historyRef: RefObject<number[]>;
  /** Grabando de verdad (no en pausa): las barras van en rojo */
  recording: boolean;
}

/** Onda en vivo: barras redondeadas que se desplazan de derecha a izquierda; las más antiguas se desvanecen */
export function LiveWave({ historyRef, recording }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const recordingRef = useRef(recording);
  recordingRef.current = recording;

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;
    const resize = () => {
      const rect = element.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      element.width = Math.round(width * dpr);
      element.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);

    // Los tokens usan light-dark(): el canvas no lo entiende, así que se pide al navegador el color ya resuelto
    let red = '#ff3b30';
    let gray = '#8e8e93';
    const readColors = () => {
      const resolve = (name: string) => {
        element.style.color = `var(${name})`;
        const resolved = getComputedStyle(element).color;
        element.style.color = '';
        return resolved;
      };
      red = resolve('--red');
      gray = resolve('--label-3');
    };
    readColors();

    let raf = 0;
    let frame = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (++frame % 120 === 0) readColors(); // por si cambia el modo día/noche mientras se graba
      context.clearRect(0, 0, width, height);
      const history = historyRef.current;
      const slot = width / WAVE_HISTORY;
      const bar = Math.max(2, slot * 0.52);
      const offset = WAVE_HISTORY - history.length;
      context.fillStyle = recordingRef.current ? red : gray;
      for (let i = 0; i < WAVE_HISTORY; i++) {
        const value = i < offset ? 0 : history[i - offset];
        const barHeight = Math.max(bar, Math.min(1, value) * height * 0.94);
        context.globalAlpha = 0.22 + 0.78 * (i / WAVE_HISTORY);
        context.beginPath();
        context.roundRect(i * slot + (slot - bar) / 2, (height - barHeight) / 2, bar, barHeight, bar / 2);
        context.fill();
      }
      context.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [historyRef]);

  return <canvas ref={canvas} className="live-wave" aria-hidden />;
}
