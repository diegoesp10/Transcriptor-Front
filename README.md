# Murmur · Frontal del transcriptor de reuniones

Frontal web (React) para el backend `MeetingTranscriber.Api` (.NET 10, carpeta `Transcriptor Reuniones`). Permite **grabar dentro de la propia app**, subir audios y vídeos, seguir la transcripción, leerla con el audio sincronizado, **analizarla** y **descargarla**. Diseño responsive, en español e inglés, modo día/noche.

## Arranque

```bash
pnpm install
pnpm dev          # http://localhost:5180  → API real (VITE_BACKEND_URL, por defecto https://localhost:52610)
pnpm dev:mock     # frontal + backend simulado (puerto 5290), sin SQL Server / FFmpeg / Whisper / Ollama
pnpm build        # tsc --noEmit + vite build → dist/
pnpm api:check    # compara types.ts con el OpenAPI de la API en marcha (/openapi/v1.json)
```

El `.env` (copia de `.env.example`) ya trae la clave de **desarrollo** de `appsettings.Development.json`. `.env` está en `.gitignore`.

- La API se usa por HTTPS (`https://localhost:52610`, el perfil de Visual Studio). El proxy acepta su certificado de desarrollo; el navegador no lo ve.
- Grabar necesita **HTTPS o `localhost`** (restricción del navegador para el micrófono).
- El puerto es el **5180** (no el 5173) para poder tener SyncForge Front abierto a la vez.
- `pnpm dev:mock`: un archivo con «fail» en el nombre falla la primera vez y funciona al reintentar. `MOCK_TIMING=chunk` simula un resultado antiguo (etiquetas `chunk-N:A`), `MOCK_NOT_READY=1` motores sin preparar (503), `MOCK_NO_AI=1` Ollama parado y `MOCK_READ_LIMIT=10` fuerza los 429.

## Cómo habla con la API

| Qué | Cómo |
|---|---|
| Clave `X-Api-Key` | La añade el **proxy de Vite** (`BACKEND_API_KEY`, sin prefijo `VITE_`): no entra en el JavaScript del navegador. En producción, hazlo en el proxy inverso. |
| CORS | La API ya lo tiene (`Cors:AllowedOrigins`: 5173 y 3000 en Development), pero el frontal no lo necesita: con proxy el navegador solo habla con su origen (5180). |
| Subida | `POST /api/meetings?fileName=&language=` con el archivo como cuerpo `application/octet-stream` (XHR, con progreso y cancelación). Máx. 2 GB. |
| Estado | `GET /api/meetings/{id}` mientras haya trabajos en curso: una ronda cada `max(3 s, 2,5 s × trabajos)` (≤ 24 consultas/min aunque haya muchos; ×4 con la pestaña oculta). |
| Transcripción | `GET …/transcript` (se cachea en el navegador) y `GET …/transcript.txt`. |
| Fallos | `POST …/retry` (solo en `Failed`, con límite de reintentos: 409 `MeetingRetryLimitExceeded`). Se muestran `errorMessage`/`errorCode` traducidos y `retryCount`. |
| Motores | `GET /api/transcription/configuration` al conectar y en Ajustes → «Comprobar ahora»: Whisper, FFmpeg, hablantes y Ollama. Si `ready=false` se avisa antes de subir (la subida daría 503). |
| Límites | El backend limita por IP (60 lecturas/min por endpoint, 120/min en total, 1 subida a la vez y 3/min) y bloquea la IP si se insiste. El frontal sube de una en una y espacia las subidas; ante un **429** o un **403** de bloqueo entra en pausa el tiempo de `Retry-After` sin enviar nada (pastilla «En espera»). Nunca reintenta solo un POST. |
| Diagnóstico | `GET /api/errors` es para el operador: el frontal no lo usa a propósito. |

Contrato vivo: `/openapi/v1.json` (UI en `/api-docs`). Tipos de los DTO en `src/api/types.ts`; `pnpm api:check` avisa si el backend se desvía. Extensiones admitidas, en `src/utils/media.ts` (igual que `MeetingService.Extensions`).

## Qué hace el frontal por su cuenta

La API **no lista reuniones**, y guarda solo una copia temporal (24 h) de cada una, así que:

- La **biblioteca vive en el navegador** (IndexedDB: metadatos, archivo original, transcripción en caché). «Eliminar» en una tarjeta borra solo la copia de trabajo de este navegador (no toca la carpeta del usuario ni el servidor).
- Las grabaciones se guardan **por trozos cada segundo**: si se cierra la pestaña o falla el navegador, se recuperan al volver.
- «Abrir por identificador» recupera una reunión de otro navegador (sin audio).
- **Grabación**: micrófono, o *Reunión online* (micrófono + audio de una pestaña/pantalla, para Teams/Meet/Zoom en el navegador; hay que marcar «Compartir audio»). Pausa, onda en vivo, la pantalla se mantiene encendida, y se puede navegar por la app mientras graba.
- **Análisis** (pestaña propia): reparto de palabras por voz, línea de tiempo, palabras clave, acuerdos/tareas, cifras y fechas a verificar, preguntas. Es **local y por patrones de texto**; cada hallazgo enlaza con el momento exacto. El resumen con el modelo del servidor va aparte (ver más abajo).
- **Descargas**: TXT, Markdown, SRT, VTT, JSON (con los nombres de voz que pongas), copiar, TXT original del servidor y el audio original.
- **Hablantes**: la diarización local del backend da etiquetas globales (`Hablante 1`, `Hablante 2`…, `speakerScope: "meeting"`) estables en toda la reunión; `null` es atribución incierta («Hablante sin determinar»). Se les puede poner nombre a mano (solo local). Las transcripciones antiguas con `chunk-N:A` siguen funcionando, con el aviso de que «A» puede ser otra persona en otro fragmento.

## Micrófono

Antes de grabar se puede elegir el micrófono (Estudio y Ajustes). `useMicrophones` lista las entradas de audio de **la máquina donde se abre la app** y se actualiza solo al enchufar o quitar unos auriculares. Detalles que conviene saber:

- El navegador **solo revela los nombres** de los dispositivos después de que el usuario haya dado permiso de micrófono una vez. Hasta entonces se muestra «Permitir acceso» (abre el micrófono un instante y lo suelta; no graba nada).
- «Probar» abre el dispositivo elegido y muestra su nivel en directo, para comprobarlo antes de empezar. Se apaga solo al grabar o al salir.
- La elección se guarda en este navegador (`mm-prefs`) y se aplica a todas las sesiones, también al modo «Reunión online». Si el micrófono guardado ya no existe, se graba con el predeterminado del sistema y se avisa.
- Se oculta el alias `communications` que Chrome añade en Windows y el predeterminado se presenta con su nombre real.

## Destino final: carpeta local

Acordado con el backend (`docs/LOCAL-STORAGE.md`): el destino final de cada reunión es **una carpeta del ordenador del usuario**; el servidor solo conserva una copia temporal mientras procesa. Implementado en `src/local/folder.ts` (port a TypeScript de `docs/browser-local-storage.mjs`), `src/state/folder.tsx` y los paneles `FolderPanel`, `LocalSavePanel` y `SummaryPanel`.

1. **Elegir carpeta** (Estudio o Ajustes). Usa `showDirectoryPicker` (Chrome/Edge, HTTPS o localhost), que solo se abre desde un clic. El handle se guarda en IndexedDB y **nunca sale del navegador**; el navegador suele pedir el permiso otra vez al reiniciar, y entonces aparece «Renovar permiso». Sin soporte (Firefox, Safari), se ofrecen descargas.
2. **Guardar**: `GET /local-export` da el manifiesto; se escribe `meeting-{id}/` con `recording.*`, `transcript.json`, `transcript.txt` y, si ya se generó, `summary.json` + `summary.txt`. El original se escribe desde el navegador si lo tiene (sin descargarlo otra vez), y cada archivo se verifica por tamaño al terminar. Por defecto se guarda **solo** al acabar la transcripción (ajuste «Guardar al terminar»).
3. **Resumen** (pestaña Análisis): lo genera el servidor con Ollama en local; solo a petición, porque tarda minutos y el servidor hace uno a la vez (`LocalInferenceBusy`). Siempre se muestra como borrador y cada punto enlaza con los segmentos que lo respaldan. Se guarda en el navegador y no se regenera al guardar en la carpeta.
4. **Eliminar la copia del servidor**: botón manual, en dos clics, que solo se activa cuando los archivos están guardados, y que antes comprueba que la transcripción está en caché local. Llama a `POST /local-export/confirm` (irreversible: el servidor borra original y transcripción; no toca los backups). Nunca es automático.

`pnpm api:check ../"Transcriptor Reuniones"/docs/openapi.json` valida los contratos nuevos aunque la API en marcha aún no tenga la migración.


## Estructura

```
src/api/        types.ts (DTOs) · client.ts (fetch + XHR con progreso)
src/db/         IndexedDB (idb.ts) y modelo (model.ts)
src/state/      library (biblioteca + subidas + sondeo) · engine (motores del servidor) · recorder (grabación global) · toasts · route (hash)
src/hooks/      useRecorder · useMediaPlayer · useIngest · useTheme · usePrefs · useBackendStatus …
src/components/ Navigation, LiveWave, Waveform, MediaPlayer, Transcript, Analysis, SummaryPanel, EngineNotice …
src/views/      Studio · Library · Meeting · Settings
src/utils/      format · media · transcript (hablantes + análisis) · exporters · errors
src/i18n/       index.tsx + locales/es.json y en.json (TypeScript exige las mismas claves)
src/styles/     tokens (light-dark) · base (cristal) · layout · components · views
scripts/        mock-backend.mjs · dev-mock.mjs · check-contract.mjs
```

## Convenciones

Las mismas que SyncForge Front: React 19 + TypeScript estricto + Vite 8 + pnpm, **sin librería de UI ni Tailwind**, iconos `lucide-react`, tipografías empaquetadas (`@fontsource`, sin CDN: RGPD), textos solo en `locales/*.json`, sin router ni estado global externo, `localStorage` solo para preferencias y siempre en `try/catch`. Antes de dar algo por terminado: `pnpm build`.

Diseño: sigue las pautas públicas de interfaz de Apple (listas agrupadas sobre fondo neutro, colores del sistema, controles segmentados con pastilla deslizante, interruptores, botones en cápsula de 44 px, esquinas generosas, tipografía del sistema) con el vidrio translúcido reservado a la capa de navegación: barra lateral flotante (barra de pestañas en móvil), menús, avisos y reproductor flotante. El contenido va en superficies sólidas. Sin degradados ni fondos animados. Todo está en `src/styles` (`tokens.css` define cada color una vez con `light-dark()`: modo claro y oscuro, que sigue al sistema o se fuerza en Ajustes). `prefers-reduced-motion` desactiva las animaciones.

**Aviso legal del diseño:** no se usa ningún recurso de Apple (logotipos, SF Symbols, tipografía San Francisco empaquetada, capturas ni nombres). Detalle, licencias de terceros y recomendaciones en [NOTICE.md](NOTICE.md).

## Siguientes pasos sugeridos (backend)

1. `GET /api/meetings` — `IMeetingRepository.ListAsync` ya existe, solo falta mapearlo; la biblioteca dejaría de depender del navegador.
2. Un resumen que no bloquee la petición HTTP (hoy puede tardar hasta 20 min dentro de la misma llamada).
3. En producción, un proxy inverso que añada `X-Api-Key` y reenvíe `/api` y `/health`.
4. Cancelar una transcripción en curso y editar la transcripción (versión corregida con historial).
5. Autenticación por usuario: hoy una sola clave compartida da acceso a cualquier reunión cuyo id se conozca (ya lo advierte tu README).
