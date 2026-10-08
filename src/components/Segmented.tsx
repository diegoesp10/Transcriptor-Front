import type { CSSProperties, ReactNode } from 'react';

interface Option<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  title?: string;
  /** Nombre accesible cuando la opción solo lleva un icono */
  ariaLabel?: string;
}

interface Props<T extends string> {
  value: T;
  options: Option<T>[];
  onChange: (value: T, origin: { x: number; y: number }) => void;
  label: string;
  className?: string;
}

/** Control segmentado: pista gris con una pastilla blanca que se desliza hasta la opción elegida */
export function Segmented<T extends string>({ value, options, onChange, label, className = '' }: Props<T>) {
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  const style = { '--n': options.length, '--i': index } as CSSProperties;
  return (
    <div className={`segmented ${className}`} style={style} role="radiogroup" aria-label={label}>
      <i className="segmented-thumb" aria-hidden />
      {options.map((option) => (
        <button
          key={option.value}
          role="radio"
          aria-checked={option.value === value}
          className={option.value === value ? 'is-on' : ''}
          disabled={option.disabled}
          title={option.title}
          aria-label={option.ariaLabel}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            onChange(option.value, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
