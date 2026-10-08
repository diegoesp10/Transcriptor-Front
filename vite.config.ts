import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// Versión de package.json, visible en Ajustes
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * El proxy reenvía /api y /health al backend .NET. Dos motivos:
 *  1. Sin CORS: con proxy el navegador solo habla con su propio origen.
 *  2. La API exige X-Api-Key. La añade el proxy (variable BACKEND_API_KEY, sin prefijo VITE_), así la clave no viaja en el
 *     bundle ni se ve en el navegador. En producción, haz lo mismo en el proxy inverso (nginx, IIS, YARP…).
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyOptions = {
    target: env.VITE_BACKEND_URL || 'https://localhost:52610',
    changeOrigin: true,
    secure: false,
    // Las subidas pueden ser de gigas: sin límite de tiempo en el proxy
    timeout: 0,
    proxyTimeout: 0,
    headers: env.BACKEND_API_KEY ? { 'X-Api-Key': env.BACKEND_API_KEY } : undefined,
  };
  const proxy = { '/api': proxyOptions, '/health': proxyOptions };

  return {
    plugins: [react()],
    define: { __APP_VERSION__: JSON.stringify(version) },
    build: {
      rolldownOptions: {
        output: {
          // React va en su propio trozo: casi nunca cambia y se queda en la caché del navegador entre despliegues
          codeSplitting: {
            groups: [
              { name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
              { name: 'locales', test: /[\\/]src[\\/]i18n[\\/]locales[\\/]/ },
            ],
          },
        },
      },
    },
    // 5180 y no el 5173 por defecto de Vite, para no chocar con otros proyectos. No hace falta que esté en los orígenes CORS
    // de la API: el navegador solo habla con el proxy (mismo origen). strictPort: si está ocupado falla en vez de saltar a
    // otro puerto (se puede cambiar con --port).
    server: { port: 5180, strictPort: true, proxy },
    preview: { port: 4180, proxy },
  };
});
