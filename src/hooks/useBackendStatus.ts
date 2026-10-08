import { useCallback, useEffect, useState } from 'react';
import { currentPause, onPauseChange, ping, type ApiPause } from '../api/client';

/** limited: el servidor ha pedido esperar (429) o ha bloqueado la IP un rato (403); no se le envía nada hasta entonces */
export type BackendState = 'checking' | 'online' | 'offline' | 'limited';

/** Pausa impuesta por el servidor, si la hay (se actualiza sola al empezar y al terminar) */
export function useApiPause(): ApiPause | null {
  const [pause, setPause] = useState(currentPause);
  useEffect(() => onPauseChange(setPause), []);
  return pause;
}

/** Comprueba /health al abrir, al volver a la pestaña y cada 15 s (4 por minuto: muy por debajo del límite del servidor) */
export function useBackendStatus() {
  const [health, setHealth] = useState<'checking' | 'online' | 'offline'>('checking');
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const pause = useApiPause();

  const check = useCallback(async () => {
    const ok = await ping();
    if (ok === null) return true; // en pausa: el servidor está vivo, solo pide esperar
    setHealth(ok ? 'online' : 'offline');
    setCheckedAt(Date.now());
    return ok;
  }, []);

  useEffect(() => {
    void check();
    const timer = setInterval(() => {
      if (!document.hidden) void check();
    }, 15_000);
    const onVisible = () => {
      if (!document.hidden) void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [check]);

  // Al terminar la pausa se vuelve a comprobar enseguida
  const [wasPaused, setWasPaused] = useState(false);
  useEffect(() => {
    if (pause) setWasPaused(true);
    else if (wasPaused) {
      setWasPaused(false);
      void check();
    }
  }, [pause, wasPaused, check]);

  const state: BackendState = pause ? 'limited' : health;
  return { state, checkedAt, check, pause };
}
