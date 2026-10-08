import type { ElementType, ReactNode } from 'react';

interface Props {
  /** Rótulo de la sección, sobre la tarjeta. Sin título, la tarjeta va sola. */
  title?: ReactNode;
  /** Texto corto a la derecha del rótulo (contador, estado…) */
  aside?: ReactNode;
  as?: ElementType;
  className?: string;
  /** Sin relleno en la tarjeta (cuando el contenido ya lo lleva) */
  flush?: boolean;
  children: ReactNode;
  label?: string;
}

/** Sección agrupada: rótulo pequeño encima y una tarjeta sólida debajo, como las listas agrupadas de los ajustes del sistema */
export function Panel({ title, aside, as: Tag = 'section', className = '', flush, children, label }: Props) {
  return (
    <Tag className={`panel ${className}`} aria-label={label}>
      {title != null && (
        <header className="panel-head">
          <h2>{title}</h2>
          {aside ? <span>{aside}</span> : null}
        </header>
      )}
      <div className={`panel-body ${flush ? 'is-flush' : ''}`}>{children}</div>
    </Tag>
  );
}
