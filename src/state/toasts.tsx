import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useI18n } from '../i18n';

type Kind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: Kind;
  text: string;
}

interface Toasts {
  push: (kind: Kind, text: string) => void;
}

const ToastContext = createContext<Toasts | null>(null);

const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info } as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((toast) => toast.id !== id)), []);
  const push = useCallback(
    (kind: Kind, text: string) => {
      const id = next.current++;
      setToasts((all) => [...all.slice(-3), { id, kind, text }]);
      setTimeout(() => dismiss(id), kind === 'error' ? 8000 : 4500);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="region" aria-label={t('toasts.region')} aria-live="polite">
        {toasts.map((toast) => {
          const Icon = ICONS[toast.kind];
          return (
            <div key={toast.id} className={`toast toast-${toast.kind} glass`} role={toast.kind === 'error' ? 'alert' : 'status'}>
              <Icon size={18} aria-hidden />
              <span>{toast.text}</span>
              <button className="icon-btn icon-btn-sm" onClick={() => dismiss(toast.id)} aria-label={t('common.close')}>
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToasts(): Toasts {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToasts debe usarse dentro de <ToastProvider>');
  return ctx;
}
