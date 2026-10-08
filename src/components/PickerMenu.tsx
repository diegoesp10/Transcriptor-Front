import { Fragment, useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { Check, ChevronsUpDown, type LucideIcon } from 'lucide-react';
import { usePopover } from '../hooks/usePopover';

export interface PickerOption<T extends string> {
  value: T;
  /** Nombre en el menú */
  label: string;
  /** Segunda línea en el menú (p. ej. el nombre real del dispositivo o el idioma en su propia lengua) */
  hint?: string;
  /** Texto del botón cuando no debe ser el nombre del menú */
  short?: string;
  /** Icono a la izquierda de la opción; sin icono se usa `code` o el icono general del selector */
  icon?: LucideIcon;
  /** Código corto que se muestra en una pastilla en lugar del icono (p. ej. ES, EN) */
  code?: string;
  /** Raya de separación después de esta opción */
  separatorAfter?: boolean;
}

interface Props<T extends string> {
  value: T;
  options: PickerOption<T>[];
  onChange: (value: T) => void;
  /** Nombre accesible del selector y título del menú */
  label: string;
  /** Título del menú, si debe ser distinto del nombre del selector */
  menuTitle?: string;
  /** Icono del botón cuando la opción elegida no tiene uno propio */
  icon?: LucideIcon;
  disabled?: boolean;
  /**
   * Lado del botón al que se alinea el menú, de preferencia: `end` cuando el botón está a la derecha (filas), `start`
   * cuando está a la izquierda. Si en ese lado no cabe, se abre hacia el otro.
   */
  align?: 'start' | 'end';
  className?: string;
}

/**
 * Selector con botón cápsula y menú emergente de vidrio, como los menús del sistema: la opción elegida lleva una marca,
 * se maneja con el teclado (flechas, Inicio/Fin, primera letra, Escape) y en pantallas estrechas ocupa el ancho de su
 * tarjeta. Es el mismo para el micrófono, el idioma y cualquier otra lista de opciones de la app.
 */
export function PickerMenu<T extends string>({ value, options, onChange, label, menuTitle, icon, disabled, align = 'end', className = '' }: Props<T>) {
  const { open, setOpen, ref } = usePopover();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const current = options.find((option) => option.value === value) ?? options[0];

  // Que el menú nunca se salga de la pantalla: si no cabe en su lado, se abre hacia el otro; si no cabe en ninguno
  // (pantallas muy estrechas), se desplaza lo justo. Se mide antes de pintar, así que no se ve ningún salto.
  useLayoutEffect(() => {
    const element = panel.current;
    if (!open || !element) return;
    const margin = 8;
    const fits = () => {
      const rect = element.getBoundingClientRect();
      return rect.left >= margin && rect.right <= window.innerWidth - margin;
    };
    element.style.marginLeft = '';
    if (fits()) return;
    element.classList.toggle('is-start');
    element.classList.toggle('is-end');
    if (fits()) return;
    const rect = element.getBoundingClientRect();
    const shift = rect.left < margin ? margin - rect.left : window.innerWidth - margin - rect.right;
    element.style.marginLeft = `${shift}px`;
  }, [open]);

  // Al abrir, el foco va a la opción elegida (solo al abrir, no en cada render)
  const currentIndex = useRef(0);
  currentIndex.current = Math.max(0, options.indexOf(current));
  useEffect(() => {
    if (open) items.current[currentIndex.current]?.focus();
  }, [open]);

  const choose = (next: T) => {
    onChange(next);
    setOpen(false);
    trigger.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const index = items.current.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (to: number) => {
      event.preventDefault();
      items.current[(to + options.length) % options.length]?.focus();
    };
    if (event.key === 'ArrowDown') focus(index + 1);
    else if (event.key === 'ArrowUp') focus(index - 1);
    else if (event.key === 'Home') focus(0);
    else if (event.key === 'End') focus(options.length - 1);
    else if (event.key === 'Escape' || event.key === 'Tab') {
      setOpen(false);
      trigger.current?.focus();
    } else if (event.key.length === 1 && /\S/.test(event.key)) {
      // Primera letra: salta a la siguiente opción que empiece por ella
      const letter = event.key.toLocaleLowerCase();
      for (let step = 1; step <= options.length; step++) {
        const candidate = (index + step) % options.length;
        if (options[candidate].label.toLocaleLowerCase().startsWith(letter)) return focus(candidate);
      }
    }
  };

  if (!current) return null;
  const TriggerIcon = current.icon ?? icon;
  const shown = current.short ?? current.label;

  return (
    <div className={`menu picker ${className}`} ref={ref}>
      <button
        ref={trigger}
        type="button"
        className="picker-btn"
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current.hint && current.hint !== shown ? `${shown} (${current.hint})` : shown}`}
      >
        {TriggerIcon && <TriggerIcon size={15} aria-hidden />}
        <span className="picker-value">{shown}</span>
        <ChevronsUpDown size={14} aria-hidden />
      </button>
      {open && (
        <div ref={panel} className={`menu-panel popover glass picker-menu is-${align}`} role="listbox" aria-label={label} onKeyDown={onKeyDown}>
          <p className="menu-title">{menuTitle ?? label}</p>
          {options.map((option, index) => {
            const Icon = option.icon ?? (option.code ? null : icon);
            const isCurrent = option.value === current.value;
            return (
              <Fragment key={option.value || '·'}>
                <button
                  ref={(element) => {
                    items.current[index] = element;
                  }}
                  type="button"
                  role="option"
                  aria-selected={isCurrent}
                  className={`menu-item ${isCurrent ? 'is-current' : ''}`}
                  onClick={() => choose(option.value)}
                >
                  {option.code ? <span className="menu-code" aria-hidden>{option.code}</span> : Icon ? <Icon size={18} /> : null}
                  <span>
                    <b>{option.label}</b>
                    {option.hint && <small>{option.hint}</small>}
                  </span>
                  <Check size={16} className="menu-check" aria-hidden />
                </button>
                {option.separatorAfter && index < options.length - 1 && <hr />}
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
