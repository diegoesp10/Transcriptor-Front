import { useEffect, useRef, type RefObject } from 'react';

interface Props {
  levelRef: RefObject<number>;
  /** Mientras es false el medidor queda a cero y no consume fotogramas */
  live: boolean;
  label: string;
}

/** Medidor de nivel de entrada: una cápsula que se llena con la voz. Lee el nivel en cada fotograma sin renderizar. */
export function LevelMeter({ levelRef, live, label }: Props) {
  const fill = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = fill.current;
    if (!element) return;
    if (!live) {
      element.style.transform = 'scaleX(0)';
      return;
    }
    let raf = 0;
    const loop = () => {
      // Raíz cuadrada: la voz normal llega a media barra y los picos, al final
      const level = Math.min(1, Math.sqrt(levelRef.current));
      element.style.transform = `scaleX(${level.toFixed(3)})`;
      element.dataset.hot = level > 0.92 ? 'true' : 'false';
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [live, levelRef]);

  return (
    <span className="level" role="img" aria-label={label}>
      <span ref={fill} className="level-fill" />
    </span>
  );
}
