# Murmur

Frontal web para transcribir reuniones. Graba desde el navegador (o sube un audio o un vídeo), envíalo a transcribir y obtén un texto con marcas de tiempo y hablantes, sincronizado con el audio, que puedes buscar, analizar, resumir y exportar.

Murmur es solo la interfaz. La transcripción la hace el backend **MeetingTranscriber.Api** (.NET 10), que se distribuye por separado y ejecuta los modelos en local: Whisper para transcribir, Community-1 para separar hablantes y Ollama para resumir. Para probar la interfaz sin backend hay un servidor simulado incluido (ver [Probar sin backend](#probar-sin-backend)).

## Qué hace

- **Grabar** con un micrófono, que se puede elegir y probar antes de empezar. Permite pausar, y recupera la grabación si se cierra la pestaña.
- **Seguir la transcripción en directo**: fase actual con su porcentaje, audio procesado, tiempo que lleva y voces detectadas, con el [canal de progreso](docs/PROGRESO-EN-TIEMPO-REAL.md) del backend (o consultando el estado cada pocos segundos si no lo tiene).
- **Nombres de las voces**: si alguien se presenta («me llamo Marta»), el servidor lo detecta y la transcripción lo muestra; se pueden cambiar a mano.
- **Subir** audio y vídeo (`mp3`, `wav`, `m4a`, `flac`, `ogg`, `aac`, `mp4`, `mov`, `mkv`, `webm`; hasta 2 GB) con progreso y cancelación.
- **Leer** la transcripción con el audio sincronizado: haz clic en una frase para escucharla, busca en el texto y ponle nombre a cada hablante.
- **Analizar** en el navegador, sin IA: reparto de intervenciones, línea de tiempo, palabras clave, acuerdos y tareas, cifras y fechas a verificar y preguntas.
- **Resumir** bajo demanda con el modelo local del servidor. Siempre es un borrador, y cada punto enlaza con las frases que lo respaldan.
- **Exportar** a TXT, Markdown, SRT, VTT o JSON, o copiar al portapapeles.
- **Guardar en una carpeta de tu equipo** la grabación, la transcripción y el resumen y, una vez guardados, borrar la copia temporal del servidor.
- Diseño adaptable a escritorio, tableta y móvil, con modo claro y oscuro, en español e inglés.

## Requisitos

- **Node.js 22.12** o superior.
- **pnpm 10**. `corepack enable` lo activa con la versión fijada en `package.json`.
- Un navegador actual. Para elegir una carpeta de destino hace falta **Chrome o Edge**; en Firefox y Safari los archivos se ofrecen como descargas.
- Para transcribir de verdad, una instancia de **MeetingTranscriber.Api** accesible desde tu equipo y su clave de API.

## Puesta en marcha

### Probar sin backend

Arranca la interfaz junto con un backend simulado que imita el contrato real. No necesita base de datos, FFmpeg ni modelos:

```bash
git clone <url-del-repositorio> murmur
cd murmur
corepack enable
pnpm install
pnpm dev:mock
```

Abre <http://localhost:5180>. Las transcripciones son un texto de ejemplo, pero el flujo completo funciona: subir, procesar, fallar y reintentar, resumir, guardar y borrar.

### Con el backend real

1. Arranca MeetingTranscriber.Api siguiendo su propia documentación. En desarrollo escucha por defecto en `https://localhost:52610` y en `http://localhost:52611`.
2. La configuración de desarrollo ya viene en `.env.development`: apunta a `https://localhost:52610` con la clave pública de desarrollo del backend. Si tu backend está en otra URL, crea `.env.development.local` (no se sube al repositorio) con lo que cambie:

   | Variable | Para qué sirve |
   |---|---|
   | `BACKEND_URL` | URL del backend. Por defecto, `https://localhost:52610`. |
   | `BACKEND_API_KEY` | Clave que exige el backend (cabecera `X-Api-Key`). Por defecto, la de desarrollo. |
   | `VITE_MAX_FILE_MB` | Opcional. Tamaño máximo por archivo que acepta la interfaz (2000 por defecto, como el backend). |

3. Arranca la interfaz:

   ```bash
   pnpm dev
   ```

   Abre <http://localhost:5180>. En **Ajustes → Motores del servidor** puedes ver si el backend tiene listos los modelos de transcripción, de hablantes y de resumen.

Para comprobar que la interfaz y el backend hablan el mismo contrato (se lee el OpenAPI que el backend publica en modo Development):

```bash
pnpm api:check                              # usa BACKEND_URL
pnpm api:check https://mi-servidor:52610    # otra URL
pnpm api:check ruta/a/openapi.json          # un archivo de contrato
```

## Scripts

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Servidor de desarrollo en <http://localhost:5180>, conectado al backend de `BACKEND_URL`. |
| `pnpm dev:mock` | Lo mismo, pero conectado al backend simulado (puerto 5290). Los argumentos extra van a Vite: `pnpm dev:mock --port 5181`. |
| `pnpm mock` | Solo el backend simulado. |
| `pnpm build` | Comprueba los tipos y compila para producción en `dist/`. |
| `pnpm start` | Servidor de producción (`server/index.mjs`) con la compilación de `dist/`. Se configura con variables de entorno o `.env.production`. |
| `pnpm preview` | Sirve `dist/` con Vite en <http://localhost:4180>, para revisar la compilación rápidamente. |
| `pnpm typecheck` | Solo la comprobación de tipos. |
| `pnpm api:check` | Compara los tipos de la interfaz con el contrato OpenAPI del backend. |
| `pnpm docker:build` / `pnpm docker:run` | Imagen Docker de producción, y arrancarla con `.env.production`. |

El backend simulado acepta variables de entorno para probar casos concretos:

| Variable | Efecto |
|---|---|
| `MOCK_NOT_READY=1` | Los motores no están listos: la subida y el reintento responden 503. |
| `MOCK_NO_AI=1` | El resumidor no está disponible (503). |
| `MOCK_READ_LIMIT=10` | Lecturas por minuto antes de responder 429 (60 por defecto, como el real). |
| `MOCK_TIMING=chunk` | Transcripción en el formato antiguo, con tiempos por fragmento. |
| `MOCK_NO_EVENTS=1` | Backend antiguo, sin progreso en tiempo real: la interfaz consulta el estado cada pocos segundos. |

Un archivo con `fail` en el nombre falla la primera vez y funciona al reintentar.

## Cómo se conecta con el backend

El navegador nunca habla directamente con la API. Todas las peticiones van a `/api` y `/health` en el mismo origen que la interfaz, y un proxy las reenvía al backend **añadiendo la cabecera `X-Api-Key`**. Así la clave no forma parte del JavaScript que descarga el navegador, y no hace falta configurar CORS.

- En desarrollo, el proxy lo pone Vite (`vite.config.ts`).
- En producción, lo pone el servidor incluido (`server/index.mjs`), que lee la URL y la clave de variables de entorno (ver [Despliegue](#despliegue)).

La biblioteca de reuniones se guarda en el navegador (IndexedDB), porque la API no lista reuniones. El servidor conserva cada reunión unas 24 horas, y el destino final es una carpeta del usuario.

Los detalles (endpoints, sondeo, límites de peticiones, flujo de guardado y borrado, micrófonos) están en [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).

## Despliegue

Hay dos entornos: **desarrollo** (`pnpm dev`, configurado en `.env.development`) y **producción** (el servidor de `server/index.mjs`, configurado con variables de entorno al arrancar). Una misma compilación sirve para cualquier entorno de producción o preproducción.

```bash
pnpm build
BACKEND_URL=https://api.interna.example.com BACKEND_API_KEY=… pnpm start   # http://localhost:8080
```

O con Docker:

```bash
cp .env.production.example .env.production   # y rellénalo
docker compose up -d --build
```

| Variable | |
|---|---|
| `BACKEND_URL` | URL del backend (obligatoria). |
| `BACKEND_API_KEY` | Clave del backend (obligatoria, secreto). La de desarrollo no se acepta. |
| `APP_ENV` | `production` por defecto; otro valor (`staging`) muestra una marca en la interfaz. |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` | Usuario y contraseña para toda la web (recomendado). |
| `PORT` | 8080 por defecto. |

El servidor sirve la web comprimida y con caché, reenvía `/api` al backend con la clave en streaming (subidas de 2 GB y progreso en directo), añade cabeceras de seguridad, ofrece `/healthz` y `/readyz`, y no arranca si la configuración no es válida. Delante hace falta HTTPS (lo exigen el micrófono y la carpeta local).

Todas las variables, plataformas (Docker, Azure, Cloud Run, Kubernetes…), el proxy HTTPS de delante, los límites por IP del backend y la lista de comprobación antes de publicar están en [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md).

## Privacidad

Las grabaciones y las transcripciones son datos personales. Murmur guarda una copia de trabajo en el almacenamiento del navegador (se borra desde **Ajustes**) y, si lo eliges, otra en una carpeta de tu equipo. El backend guarda una copia temporal mientras procesa. Antes de usarlo con reuniones reales, asegúrate de cumplir la normativa de protección de datos que te aplique, por ejemplo el RGPD: informar a los participantes, tener una base legal y decidir cuánto tiempo se conservan los datos.

## Problemas frecuentes

| Síntoma | Causa probable |
|---|---|
| La pastilla de estado dice «Sin conexión» | El backend no está arrancado o `BACKEND_URL` no apunta a él. Después de cambiar `.env.development.local`, reinicia `pnpm dev`. |
| «El servidor no acepta la clave de acceso» | `BACKEND_API_KEY` no coincide con la clave del backend. |
| «El servidor no puede transcribir ahora» | Al backend le falta algún modelo o FFmpeg. Mira **Ajustes → Motores del servidor**. |
| La pastilla dice «En espera» | El backend ha pedido bajar el ritmo de peticiones. Se reanuda sola. |
| `Port 5180 is already in use` | Hay otra instancia en ese puerto. Usa `pnpm dev --port 5181`. |
| No aparece «Seleccionar carpeta» | El navegador no lo permite (Firefox, Safari) o la página no está en HTTPS. Se ofrecen descargas en su lugar. |

## Estructura

```
src/
  api/          tipos de la API (types.ts) y cliente HTTP (client.ts)
  db/           almacenamiento local en IndexedDB
  local/        guardado en una carpeta del equipo (File System Access API)
  state/        biblioteca y subidas, grabación, motores del servidor, avisos, rutas
  hooks/        grabadora, micrófonos, reproductor, tema, preferencias, estado del backend
  components/   piezas de interfaz (reproductor, transcripción, análisis, resumen…)
  views/        pantallas: Estudio, Biblioteca, Reunión y Ajustes
  utils/        formato, audio, análisis de la transcripción, exportación, errores
  i18n/         textos en español e inglés (locales/es.json y en.json)
  styles/       tokens de diseño, base, maquetación, componentes y pantallas
scripts/        backend simulado, arranque combinado y comprobación del contrato
server/         servidor de producción (sin dependencias)
docs/           documentación técnica
public/         favicon y textos de licencias de terceros
```

## Tecnología y convenciones

React 19, TypeScript en modo estricto, Vite 8 y pnpm, sin librerías de componentes, de estilos ni de enrutado. Los iconos son de `lucide-react`, y la tipografía Inter va incluida en el paquete, sin cargarla de ningún CDN.

- Todos los textos están en `src/i18n/locales/*.json`. TypeScript avisa si a un idioma le falta una clave.
- Los colores se definen una sola vez en `src/styles/tokens.css`, con sus valores para modo claro y oscuro.
- `localStorage` se usa solo para preferencias; los datos van en IndexedDB.
- Antes de dar un cambio por terminado, `pnpm build` tiene que pasar.

## Licencias

Las licencias de los componentes de terceros y las notas sobre el diseño están en [NOTICE.md](NOTICE.md).
