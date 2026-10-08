import { useCallback, useSyncExternalStore } from 'react';

/*
 * Navegación por hash (#/estudio, #/biblioteca, #/reunion/{id}, #/ajustes): sin router, pero con botón «atrás» del
 * navegador y enlaces directos a una reunión.
 */

export type Route =
  | { name: 'studio' }
  | { name: 'library' }
  | { name: 'meeting'; id: string }
  | { name: 'settings' };

const PATHS = { studio: 'estudio', library: 'biblioteca', settings: 'ajustes' } as const;

export function parseRoute(hash: string): Route {
  const [first, second] = hash.replace(/^#\/?/, '').split('/');
  if (first === PATHS.library) return { name: 'library' };
  if (first === PATHS.settings) return { name: 'settings' };
  if (first === 'reunion' && second) return { name: 'meeting', id: decodeURIComponent(second) };
  return { name: 'studio' };
}

export const hrefOf = (route: Route): string => (route.name === 'meeting' ? `#/reunion/${encodeURIComponent(route.id)}` : `#/${PATHS[route.name]}`);

const subscribe = (notify: () => void) => {
  window.addEventListener('hashchange', notify);
  return () => window.removeEventListener('hashchange', notify);
};
const snapshot = () => window.location.hash;

export function useRoute() {
  const hash = useSyncExternalStore(subscribe, snapshot, () => '');
  const navigate = useCallback((route: Route) => {
    window.location.hash = hrefOf(route);
  }, []);
  return { route: parseRoute(hash), navigate };
}
