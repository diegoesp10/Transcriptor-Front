import { useCallback, useSyncExternalStore } from 'react';

/** Preferencias de transcripción guardadas en este navegador */
export interface Prefs {
  /** Idioma por defecto del audio (ISO 639‑1) */
  language: string;
  /** Enviar al servidor nada más guardar una grabación o un archivo */
  autoTranscribe: boolean;
  /** Guardar en la carpeta local en cuanto termine la transcripción (si hay carpeta con permiso) */
  autoSaveLocal: boolean;
  /** deviceId del micrófono elegido para grabar; '' = el predeterminado del sistema */
  micId: string;
}

const KEY = 'mm-prefs';
const listeners = new Set<() => void>();

function defaults(): Prefs {
  return { language: navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en', autoTranscribe: true, autoSaveLocal: true, micId: '' };
}

let cache: Prefs | null = null;

function read(): Prefs {
  if (cache) return cache;
  let stored: Partial<Prefs> = {};
  try {
    stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
  } catch {
    /* noop */
  }
  const base = defaults();
  cache = {
    language: typeof stored.language === 'string' && /^[a-z]{2}$/.test(stored.language) ? stored.language : base.language,
    autoTranscribe: typeof stored.autoTranscribe === 'boolean' ? stored.autoTranscribe : base.autoTranscribe,
    autoSaveLocal: typeof stored.autoSaveLocal === 'boolean' ? stored.autoSaveLocal : base.autoSaveLocal,
    micId: typeof stored.micId === 'string' ? stored.micId : base.micId,
  };
  return cache;
}

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
};

export function usePrefs() {
  const prefs = useSyncExternalStore(subscribe, read);
  const update = useCallback((changes: Partial<Prefs>) => {
    cache = { ...read(), ...changes };
    try {
      localStorage.setItem(KEY, JSON.stringify(cache));
    } catch {
      /* noop */
    }
    listeners.forEach((notify) => notify());
  }, []);
  return { prefs, update };
}
