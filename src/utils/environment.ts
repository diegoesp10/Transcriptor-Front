import type { MessageKey, Translate } from '../i18n';

/**
 * Entorno en el que corre la app: "development" con `pnpm dev`; en producción, el valor de APP_ENV del servidor
 * ("production", "staging"…), que llega en <meta name="app-environment">. Así una misma compilación sirve para todos.
 */
export const APP_ENV: string = document.querySelector<HTMLMetaElement>('meta[name="app-environment"]')?.content || import.meta.env.MODE;

/** En producción no se muestra ninguna marca; en el resto, sí, para no confundir datos de prueba con los reales */
export const IS_PRODUCTION = APP_ENV === 'production';

/** Nombre legible del entorno; uno que no se conozca se muestra tal cual */
export function envLabel(env: string, t: Translate): string {
  const key = `env.names.${env}` as MessageKey;
  const text = t(key);
  return text === key ? env : text;
}
