import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as idb from '../db/idb';
import { chooseFolder, folderPermission, renewPermission, supportsLocalFolder, type FolderPermission } from '../local/folder';

/*
 * Carpeta local elegida por el usuario como destino final de las reuniones.
 * El handle vive en el navegador (IndexedDB); el servidor nunca recibe la ruta ni el handle. El permiso no es permanente:
 * el navegador suele pedirlo otra vez al reiniciar, y entonces hace falta un clic del usuario para renovarlo.
 */

interface Folder {
  /** El navegador puede elegir carpetas (Chromium, contexto seguro) */
  supported: boolean;
  /** Ya se ha intentado restaurar la carpeta guardada */
  ready: boolean;
  handle: FileSystemDirectoryHandle | null;
  /** Nombre de la carpeta elegida (el navegador no da la ruta completa) */
  name: string | null;
  /** none: sin carpeta · granted: se puede escribir · prompt: hay que renovar el permiso con un clic · denied: rechazado */
  permission: FolderPermission | 'none';
  /** Abrir el selector del sistema. Llamar directamente desde un clic. Devuelve false si el usuario cancela. */
  choose: () => Promise<boolean>;
  /** Pedir de nuevo el permiso sobre la carpeta guardada. Llamar directamente desde un clic. */
  renew: () => Promise<boolean>;
  forget: () => Promise<void>;
}

const FolderContext = createContext<Folder | null>(null);

export function FolderProvider({ children }: { children: ReactNode }) {
  const supported = supportsLocalFolder();
  const [handle, setHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [permission, setPermission] = useState<Folder['permission']>('none');
  const [ready, setReady] = useState(!supported);

  const refresh = useCallback(async (current: FileSystemDirectoryHandle | null) => {
    setPermission(current ? await folderPermission(current) : 'none');
  }, []);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    idb
      .loadFolder()
      .then(async (stored) => {
        if (cancelled) return;
        setHandle(stored ?? null);
        await refresh(stored ?? null);
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setReady(true));
    return () => {
      cancelled = true;
    };
  }, [supported, refresh]);

  // El permiso puede cambiar mientras la pestaña está en segundo plano (o desde la configuración del navegador)
  useEffect(() => {
    if (!handle) return;
    const onFocus = () => void refresh(handle);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [handle, refresh]);

  const choose = useCallback(async () => {
    try {
      const chosen = await chooseFolder();
      await idb.saveFolder(chosen).catch(() => undefined);
      setHandle(chosen);
      setPermission('granted');
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return false; // el usuario cerró el selector
      throw error;
    }
  }, []);

  const renew = useCallback(async () => {
    if (!handle) return false;
    const granted = await renewPermission(handle);
    await refresh(handle);
    return granted;
  }, [handle, refresh]);

  const forget = useCallback(async () => {
    await idb.deleteFolder().catch(() => undefined);
    setHandle(null);
    setPermission('none');
  }, []);

  const value = useMemo<Folder>(
    () => ({ supported, ready, handle, name: handle?.name ?? null, permission, choose, renew, forget }),
    [supported, ready, handle, permission, choose, renew, forget],
  );
  return <FolderContext.Provider value={value}>{children}</FolderContext.Provider>;
}

export function useFolder(): Folder {
  const ctx = useContext(FolderContext);
  if (!ctx) throw new Error('useFolder debe usarse dentro de <FolderProvider>');
  return ctx;
}
