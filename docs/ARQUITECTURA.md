# Arquitectura e integración con el backend

Este documento explica cómo Murmur usa la API de MeetingTranscriber.Api y qué hace la interfaz por su cuenta. Para instalar y arrancar el proyecto, mira el [README](../README.md).

## Contrato

- El contrato vivo es el OpenAPI del backend: `GET /openapi/v1.json`. En modo Development se publica sin clave, y la interfaz interactiva está en `/api-docs`.
- Los tipos de la interfaz están en `src/api/types.ts`, y todas las llamadas, en `src/api/client.ts`.
- `pnpm api:check` (`scripts/check-contract.mjs`) compara las rutas, los esquemas y los enums que espera la interfaz con los que publica el backend, y termina con error si no coinciden, así que sirve también en CI. Si el backend cambia el contrato, hay que actualizar a la vez `types.ts`, `client.ts` y la lista `EXPECTED` del script.

## Endpoints que se usan

| Endpoint | Uso en la interfaz |
|---|---|
| `GET /health` | Comprobación de conexión al abrir, al volver a la pestaña y cada 15 s. No requiere clave. |
| `GET /api/transcription/configuration` | Estado de los motores (Whisper, FFmpeg, hablantes, Ollama). Se consulta al conectar y desde Ajustes. Si `ready` es `false`, se avisa antes de subir. |
| `POST /api/meetings?fileName=&language=` | Subida del archivo como cuerpo binario (`application/octet-stream`), con XHR para mostrar el progreso. Responde `202` con el estado inicial. |
| `GET /api/meetings/{id}/events` | Progreso en tiempo real (Server-Sent Events con fetch): fase, porcentaje de la fase, audio procesado y voces. Si no existe (backend antiguo), se usa el sondeo. Ver [PROGRESO-EN-TIEMPO-REAL.md](PROGRESO-EN-TIEMPO-REAL.md). |
| `GET /api/meetings/{id}/progress` | Foto del progreso para consultas puntuales (`getProgress`). El estado ya la incluye en `progress`. |
| `GET /api/meetings/{id}` | Progreso del trabajo (`Queued`, `Processing`, `Completed`, `Failed`) cuando no hay canal en directo. |
| `GET /api/meetings/{id}/transcript` | Transcripción en JSON. Se guarda en el navegador en cuanto está lista. |
| `GET /api/meetings/{id}/transcript.txt` | Transcripción en texto, tal como la genera el servidor. |
| `POST /api/meetings/{id}/retry` | Reintento explícito de una reunión fallida. El servidor limita cuántos se pueden hacer (`409 MeetingRetryLimitExceeded`). |
| `GET /api/meetings/{id}/local-export` | Lista de archivos para guardar en la carpeta local y caducidad de la copia del servidor. |
| `GET /api/meetings/{id}/recording` | Original del servidor, cuando el navegador no lo tiene. |
| `POST /api/meetings/{id}/summary` | Resumen con el modelo local (Ollama). Tarda minutos y el servidor hace uno a la vez. |
| `POST /api/meetings/{id}/local-export/confirm` | Borra la copia del servidor después de guardar. Es irreversible. |

`GET /api/errors` existe, pero la interfaz no lo usa a propósito: es un endpoint de diagnóstico para quien opera el servidor.

## Proxy y clave

La API exige la cabecera `X-Api-Key`. La añade un proxy, nunca el navegador:

- En desarrollo, Vite reenvía `/api` y `/health` a `BACKEND_URL` con la clave de `BACKEND_API_KEY` (ninguna lleva el prefijo `VITE_`, a propósito: así Vite no las incluye en el código del navegador). También acepta el certificado de desarrollo de ASP.NET y no pone límite de tiempo a las subidas.
- En producción, lo hace `server/index.mjs` con `BACKEND_URL` y `BACKEND_API_KEY` del entorno. Ver [DESPLIEGUE.md](DESPLIEGUE.md).

Como el navegador solo habla con su propio origen, no hace falta CORS.

## Límites de peticiones

El backend limita por IP: 60 lecturas por minuto en cada endpoint, 120 peticiones por minuto en total, 30 cada 10 segundos, una subida simultánea y tres por minuto. Si se insiste después de un `429`, o hay varios `401` seguidos, bloquea la IP temporalmente con un `403` (`code: ClientTemporarilyBlocked`). La interfaz se adapta así:

- **Canal en directo**: como máximo 2 flujos `/events` a la vez (el límite del backend por IP), con prioridad para la reunión que se está mirando. Mientras un flujo funciona, esa reunión no se sondea. Un tercer flujo recibiría `429 RequestConcurrencyLimited`, que no pausa el resto de la app. Si el backend no tiene el endpoint, se intenta una sola vez cada 5 minutos.
- **Sondeo**: para el resto de trabajos en curso, se consulta su estado en rondas espaciadas `max(3 s, 2,5 s × trabajos)`, lo que deja el total por debajo de unas 24 consultas por minuto, haya los trabajos que haya. Con la pestaña oculta, el ritmo es cuatro veces más lento.
- **Subidas**: una cada vez, con un máximo de tres por minuto. Las demás esperan en la cola.
- **Pausa global**: ante un `429` o un `403` de bloqueo, el cliente guarda el tiempo de `Retry-After` y, hasta que pasa, no envía ninguna petición, ni siquiera `/health`. Las llamadas que se intentan durante la pausa fallan en el propio navegador con el código `ClientPaused`. La pastilla de estado muestra «En espera» y la conexión se comprueba otra vez al terminar.
- **Sin reintentos automáticos** de subidas, reintentos ni resúmenes, porque podrían duplicar trabajo en el servidor.

## Errores

`ApiError` (en `client.ts`) recoge el estado HTTP, el `detail` y el `code` de Problem Details (o el `error` de `ErrorResponse`), el `correlationId` y `Retry-After`. `src/utils/errors.ts` lo convierte en un texto para el usuario:

- Los códigos conocidos (`WhisperModelMissing`, `NoAudio`, `LocalInferenceBusy`…) tienen traducción en `errors.codes` de los archivos de idioma.
- Si un trabajo falla con un código que no se conoce, se muestra el `errorMessage` del servidor, que es un texto controlado y nunca el mensaje en bruto del motor.
- `correlationId` sirve para buscar el fallo en los registros del servidor.

## Hablantes

Con la diarización local, el servidor devuelve `speakerScope: "meeting"`. Cada segmento trae `speakerId`, la identidad estable de la voz (`Hablante 1`, `Hablante 2`…), y `speaker`, lo que se muestra: el nombre si la persona se presentó con claridad (`SpeakerNameResolver` del backend) o la etiqueta. `speakers` lista las voces con su nombre y los segmentos donde se presentó. Murmur identifica las voces por `speakerId` (`normalizeTranscript`), muestra el nombre detectado con una marca y deja cambiarlo. `speakerId: null` significa que no se pudo atribuir con seguridad, y se muestra como «Hablante sin determinar». Los nombres que pone el usuario se guardan solo en el navegador y se aplican a la vista y a las exportaciones; la transcripción del servidor no se modifica.

Las transcripciones antiguas (`speakerScope: "chunk"`) usan etiquetas por fragmento (`chunk-N:A`). Se siguen mostrando, con un aviso de que la misma letra puede ser una persona distinta en otro fragmento.

## Biblioteca local

La API no lista reuniones, así que la biblioteca se guarda en IndexedDB (`src/db`): metadatos, archivo original, transcripción, resumen y la carpeta elegida.

- Las grabaciones se guardan en trozos de un segundo mientras se graba. Si se cierra la pestaña o el navegador falla, se recuperan al volver.
- «Abrir por identificador» añade una reunión creada en otro navegador a partir de su identificador, sin el audio original.
- «Eliminar» borra solo la copia de este navegador. No toca la carpeta del usuario ni el servidor.

## Carpeta local y copia temporal del servidor

El destino final de cada reunión es una carpeta del equipo del usuario. El servidor conserva una copia temporal (24 horas por defecto) mientras procesa. Está implementado en `src/local/folder.ts`, `src/state/folder.tsx` y los paneles `FolderPanel`, `LocalSavePanel` y `SummaryPanel`.

1. **Elegir carpeta**, desde el Estudio o desde Ajustes. Usa `showDirectoryPicker` (Chrome y Edge, en HTTPS o `localhost`). El permiso se guarda en IndexedDB y la ruta nunca sale del navegador. Al reiniciar el navegador suele pedirse permiso otra vez («Renovar permiso»). Si el navegador no lo admite, se ofrecen descargas normales.
2. **Guardar**. Se crea una subcarpeta `meeting-{id}/` con `recording.*`, `transcript.json`, `transcript.txt` y, si ya se ha generado, `summary.json` y `summary.txt`. Si el navegador tiene el original, se escribe desde ahí sin volver a descargarlo. Cada archivo se verifica por tamaño al terminar. Con la opción «Guardar al terminar», se guarda solo cuando acaba la transcripción.
3. **Resumen** (opcional, pestaña Análisis). Se genera solo a petición y se incluye en la carpeta si existe al guardar.
4. **Eliminar la copia del servidor**. Es un botón manual de dos pasos, que solo se activa cuando los archivos están guardados y la transcripción está en el navegador. Es irreversible y nunca ocurre de forma automática.

## Grabación y micrófonos

- `useRecorder` graba un micrófono con `MediaRecorder`, a través de Web Audio para medir el nivel. Mientras graba mantiene la pantalla encendida (Wake Lock) y deja navegar por la app.
- `useMicrophones` lista las entradas de audio del equipo donde se abre la app y se actualiza al conectar o desconectar dispositivos. El navegador solo da los nombres después de conceder permiso de micrófono una vez; hasta entonces se ofrece «Permitir acceso».
- El micrófono elegido se recuerda en el navegador. Si ya no existe, se graba con el predeterminado del sistema y se avisa.
- La onda de la grabación se calcula a partir del archivo grabado, porque las animaciones en directo se detienen cuando la pestaña está en segundo plano.

## Backend simulado

`scripts/mock-backend.mjs` reproduce el contrato con datos de ejemplo, en memoria: estados y progreso por fragmentos, hablantes globales, límite de reintentos, estado de los motores, límite de lecturas con `429` y `Retry-After`, carpeta local, resumen y borrado. Las variables con las que se configura están en el README. Al reiniciarlo se pierden las reuniones, y la interfaz las trata como no encontradas.
