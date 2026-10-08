import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useRecorder, type Recording } from '../hooks/useRecorder';

/*
 * La grabación vive a nivel de aplicación: se puede navegar por la biblioteca mientras se graba una reunión.
 * Al detenerla, el resultado espera en `pending` hasta que el usuario decide (guardar, transcribir o descartar).
 */

type RecorderApi = ReturnType<typeof useRecorder> & {
  pending: Recording | null;
  /** Cierra la grabación pendiente (guardada o descartada) y borra su copia de seguridad por trozos */
  closePending: () => Promise<void>;
};

const RecorderContext = createContext<RecorderApi | null>(null);

export function RecorderProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Recording | null>(null);
  const recorder = useRecorder(setPending);

  const closePending = useCallback(async () => {
    const current = pending;
    setPending(null);
    await current?.release();
  }, [pending]);

  const value = useMemo<RecorderApi>(() => ({ ...recorder, pending, closePending }), [recorder, pending, closePending]);
  return <RecorderContext.Provider value={value}>{children}</RecorderContext.Provider>;
}

export function useRecording(): RecorderApi {
  const ctx = useContext(RecorderContext);
  if (!ctx) throw new Error('useRecording debe usarse dentro de <RecorderProvider>');
  return ctx;
}
