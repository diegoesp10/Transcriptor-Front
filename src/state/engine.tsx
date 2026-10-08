import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getTranscriptionConfig } from '../api/client';
import type { TranscriptionConfigDto } from '../api/types';

/*
 * Estado de los motores locales del servidor (Whisper, FFmpeg, diarización y Ollama), según
 * GET /api/transcription/configuration. Se pregunta al conectar y a petición (Ajustes → Comprobar ahora), nunca en bucle:
 * el estado de los modelos cambia poco y cada lectura cuenta para los límites del servidor.
 */

interface Engine {
  /** undefined: todavía no se sabe · null: no se pudo consultar */
  config: TranscriptionConfigDto | null | undefined;
  loading: boolean;
  refresh: () => Promise<void>;
}

const EngineContext = createContext<Engine | null>(null);

export function EngineProvider({ online, children }: { online: boolean; children: ReactNode }) {
  const [config, setConfig] = useState<TranscriptionConfigDto | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(() => {
    inFlight.current ??= (async () => {
      setLoading(true);
      try {
        setConfig(await getTranscriptionConfig());
      } catch {
        setConfig(null);
      } finally {
        setLoading(false);
        inFlight.current = null;
      }
    })();
    return inFlight.current;
  }, []);

  // Al (re)conectar se consulta una vez
  useEffect(() => {
    if (online) void refresh();
  }, [online, refresh]);

  const value = useMemo(() => ({ config, loading, refresh }), [config, loading, refresh]);
  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}

export function useEngine(): Engine {
  const ctx = useContext(EngineContext);
  if (!ctx) throw new Error('useEngine debe usarse dentro de <EngineProvider>');
  return ctx;
}
