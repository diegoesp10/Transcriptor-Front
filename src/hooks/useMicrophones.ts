import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/*
 * Micrófonos disponibles en la máquina donde se abre la app.
 * Ojo: el navegador solo revela los NOMBRES de los dispositivos después de que el usuario haya concedido permiso de
 * micrófono al menos una vez; antes, enumerateDevices() devuelve entradas sin etiqueta. Por eso hay un paso explícito
 * («Permitir acceso») que abre el micrófono un instante y lo suelta.
 */

export interface Microphone {
  id: string;
  /** Vacío si todavía no hay permiso */
  label: string;
}

export type MicAccess = 'unknown' | 'granted' | 'denied';

export const supportsMicrophoneList = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.enumerateDevices;

export function useMicrophones() {
  const supported = supportsMicrophoneList();
  const [devices, setDevices] = useState<Microphone[]>([]);
  const [labelled, setLabelled] = useState(false);
  const [access, setAccess] = useState<MicAccess>('unknown');

  const refresh = useCallback(async () => {
    if (!supported) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      // «communications» es un alias que Chrome añade en Windows: duplica a otro dispositivo
      const inputs = all.filter((device) => device.kind === 'audioinput' && device.deviceId !== 'communications');
      setLabelled(inputs.some((device) => device.label));
      setDevices(inputs.map((device) => ({ id: device.deviceId, label: device.label })));
    } catch {
      setDevices([]);
    }
  }, [supported]);

  // Estado del permiso (donde el navegador lo permite consultar) y cambios de hardware: enchufar o quitar unos auriculares
  useEffect(() => {
    if (!supported) return;
    void refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    let status: PermissionStatus | null = null;
    const sync = () => {
      if (!status) return;
      setAccess(status.state === 'granted' ? 'granted' : status.state === 'denied' ? 'denied' : 'unknown');
      void refresh();
    };
    navigator.permissions
      ?.query({ name: 'microphone' as PermissionName })
      .then((result) => {
        status = result;
        result.addEventListener('change', sync);
        sync();
      })
      .catch(() => undefined); // Safari/Firefox no exponen este permiso: se sabrá al pedirlo
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', refresh);
      status?.removeEventListener('change', sync);
    };
  }, [supported, refresh]);

  /** Pide permiso abriendo el micrófono un instante. Llamar desde un clic. */
  const grantAccess = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
      setAccess('granted');
      await refresh();
      return true;
    } catch (error) {
      setAccess(error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError') ? 'denied' : 'unknown');
      return false;
    }
  }, [refresh]);

  return { supported, devices, labelled, access, refresh, grantAccess };
}

export type MicTestState = 'idle' | 'starting' | 'on' | 'error';

/**
 * Prueba de micrófono: abre el dispositivo elegido y mide su nivel mientras `enabled`. El nivel (0‑1) se publica en un
 * ref para dibujarlo sin volver a renderizar. Se suelta todo al apagarla, al cambiar de dispositivo o al desmontar.
 */
export function useMicTest(deviceId: string, enabled: boolean): { levelRef: RefObject<number>; state: MicTestState } {
  const levelRef = useRef(0);
  const [state, setState] = useState<MicTestState>('idle');

  useEffect(() => {
    if (!enabled) {
      setState('idle');
      return;
    }
    let cancelled = false;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let raf = 0;

    (async () => {
      setState('starting');
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true });
        if (cancelled) return;
        context = new AudioContext();
        await context.resume();
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        context.createMediaStreamSource(stream).connect(analyser);
        const buffer = new Uint8Array(analyser.fftSize);
        const loop = () => {
          analyser.getByteTimeDomainData(buffer);
          let peak = 0;
          for (const value of buffer) peak = Math.max(peak, Math.abs(value - 128) / 128);
          levelRef.current += (Math.min(1, peak * 1.6) - levelRef.current) * 0.4;
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        setState('on');
      } catch {
        if (!cancelled) setState('error');
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      for (const track of stream?.getTracks() ?? []) track.stop();
      void context?.close().catch(() => undefined);
      levelRef.current = 0;
    };
  }, [deviceId, enabled]);

  return { levelRef, state };
}
