import { useEffect, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n';

interface Props {
  onConfirm: () => void | Promise<void>;
  label: string;
  /** Texto del segundo paso; por defecto «¿Seguro?» */
  confirmLabel?: string;
  icon?: ReactNode;
  className?: string;
  /** Solo icono: el texto va como aria-label */
  iconOnly?: boolean;
  disabled?: boolean;
}

/** Acción destructiva en dos pasos: el primer clic arma el botón y el segundo, en menos de 4 s, la ejecuta */
export function ConfirmButton({ onConfirm, label, confirmLabel, icon, className = '', iconOnly, disabled }: Props) {
  const { t } = useI18n();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  const text = armed ? (confirmLabel ?? t('common.sure')) : label;
  return (
    <button
      className={`${className} ${armed ? 'is-armed' : ''}`}
      disabled={disabled}
      aria-label={iconOnly ? text : undefined}
      title={iconOnly ? text : undefined}
      onClick={(event) => {
        event.stopPropagation();
        if (!armed) return setArmed(true);
        setArmed(false);
        void onConfirm();
      }}
      onBlur={() => setArmed(false)}
    >
      {icon}
      {(!iconOnly || armed) && <span>{text}</span>}
    </button>
  );
}
