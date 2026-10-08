import type { ReactNode } from 'react';

interface Props {
  /** 0‑1, o null cuando todavía no se sabe (el anillo gira sin fin) */
  fraction: number | null;
  children?: ReactNode;
  size?: number;
}

/** Anillo de progreso: determinado (porcentaje real) o indeterminado, con el texto en el centro */
export function ProcessingArt({ fraction, children, size = 168 }: Props) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const shown = fraction == null ? 0.25 : Math.max(0.015, Math.min(1, fraction));
  return (
    <div className="ring" style={{ width: size, height: size }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={fraction == null ? undefined : Math.round(fraction * 100)}>
      <svg viewBox="0 0 128 128" aria-hidden>
        <circle className="ring-track" cx="64" cy="64" r={radius} />
        <circle className={`ring-arc ${fraction == null ? 'is-indeterminate' : ''}`} cx="64" cy="64" r={radius} strokeDasharray={`${circumference * shown} ${circumference}`} />
      </svg>
      <div className="ring-label">{children}</div>
    </div>
  );
}
