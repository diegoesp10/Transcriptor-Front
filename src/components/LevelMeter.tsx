import { useEffect, useRef, type CSSProperties, type RefObject } from 'react';

interface Props {
  levelRef: RefObject<number>;
  /** Mientras es false el medidor queda a cero y no consume fotogramas */
  live: boolean;
  label: string;
}

const SEGMENTS = 20;

/**
 * Medidor de nivel de entrada por segmentos, como el de los ajustes de sonido: se encienden de izquierda a derecha con la
 * voz (verdes, y naranja y rojo al final). Lee el nivel en cada fotograma y solo cambia una variable CSS, sin renderizar.
 */
export function LevelMeter({ levelRef, live, label }: Props) {
  const meter = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = meter.current;
    if (!element) return;
    if (!live) {
      element.style.setProperty('--level', '0');
      return;
    }
    let raf = 0;
    let shown = 0;
    const loop = () => {
      // Raíz cuadrada: la voz normal llega a media escala y los picos, al final. Sube rápido y cae despacio, como un vúmetro.
      const target = Math.min(1, Math.sqrt(levelRef.current));
      shown = target > shown ? target : shown * 0.9 + target * 0.1;
      element.style.setProperty('--level', shown.toFixed(3));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      element.style.setProperty('--level', '0');
    };
  }, [live, levelRef]);

  return (
    <span ref={meter} className={`level ${live ? 'is-live' : ''}`} role="img" aria-label={label}>
      {Array.from({ length: SEGMENTS }, (_, index) => (
        <i key={index} style={{ '--at': (index + 0.5) / SEGMENTS } as CSSProperties} data-zone={index >= SEGMENTS - 2 ? 'peak' : index >= SEGMENTS - 5 ? 'high' : undefined} />
      ))}
    </span>
  );
}
