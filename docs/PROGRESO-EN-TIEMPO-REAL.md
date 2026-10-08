# Progreso en tiempo real

Cómo sigue Murmur una transcripción mientras el servidor la procesa. El contrato lo define el backend (MeetingTranscriber.Api, `docs/LIVE-PROGRESS.md` en su repositorio); este documento explica cómo lo usa la interfaz.

## Qué ofrece el backend

| Endpoint | Para qué lo usa Murmur |
|---|---|
| `GET /api/meetings/{id}/events` | Flujo Server-Sent Events con la foto del progreso: evento `progress` cuando algo cambia (como mucho una vez por segundo) y `heartbeat` cada 2 segundos. Se cierra al llegar a `Completed` o `Failed`. |
| `GET /api/meetings/{id}` | Estado de la reunión con la misma foto en `progress`. Es lo que se sondea cuando no hay flujo. |
| `GET /api/meetings/{id}/progress` | Solo la foto. Disponible en el cliente (`getProgress`) para consultas puntuales. |

La foto (`MeetingProgressResponse`) trae la fase (`stage`, y `step` dentro de la detección de hablantes), el porcentaje **de la fase** (`stagePercent`, 0‑100 o `null`), los fragmentos, el audio procesado, el tiempo que lleva, las voces detectadas y, si falla, el código y el mensaje controlado. No hay texto de la transcripción hasta que termina: el flujo describe el trabajo, no su resultado.

## Cómo se muestra

El backend recorre 12 fases. La interfaz las agrupa en 6 pasos:

| Paso | Fases del backend |
|---|---|
| En cola | `Queued` |
| Preparando el audio | `ExtractingAudio`, `PreparingChunks` |
| Separando las voces | `LoadingDiarizationModel`, `DetectingSpeakers` (pasos `Segmentation`, `SpeakerCounting`, `Embeddings`, `Clustering`) |
| Transcribiendo | `LoadingTranscriptionModel`, `Transcribing` |
| Reconociendo nombres | `IdentifyingSpeakers` |
| Guardando el resultado | `SavingResults` |

`Processing` es una foto reconstruida tras un reinicio del servidor, sin detalle: se deduce el paso del estado.

- **Anillo**: el porcentaje de la fase actual. Si la fase no lo puede medir (`null`), un icono animado. No se calcula un porcentaje total, porque el backend no lo da y las fases duran cosas muy distintas.
- **Detalle**: el paso de la detección de hablantes, o en la transcripción «Fragmento 2 de 3 · 12:30 de 45:00 de audio».
- **Tiempo**: «Lleva 3:12» (`elapsedSeconds`). Durante la transcripción, cuando ya ha avanzado lo suficiente, se estima lo que queda con el ritmo medido. El backend no da una estimación y en el resto de fases no se inventa.
- **Fases**: lista con las terminadas, la actual (con su barra) y las pendientes. «Separando las voces» se oculta si el servidor tiene la diarización desactivada.
- **Voces detectadas**: las que el servidor ya ha separado. Si alguien se presentó («me llamo Marta»), aparece con su nombre y la marca «Se presentó».
- **En directo / Cada pocos segundos**: indica si llegan eventos del flujo o se está sondeando.

En la biblioteca, cada tarjeta muestra el paso, el fragmento y el porcentaje de la fase.

## Cómo se conecta

- **fetch, no EventSource.** El backend lo pide así, y además permite leer el código y `Retry-After` de un rechazo. La clave la añade el proxy (Vite en desarrollo, `server/index.mjs` en producción), como en el resto de peticiones; nunca va en la URL.
- **Parser propio de SSE.** Decodifica UTF-8 en streaming y separa los eventos por línea vacía: un evento puede llegar partido en varios bloques. `progress` y `heartbeat` traen la foto completa (no son parches).
- **Duplicados.** Se descartan las fotos antiguas por `runId` y `version`. Un reintento abre otra ejecución (`retryCount` sube y `version` vuelve a empezar).
- **Como mucho 2 flujos a la vez**, que es lo que admite el backend por IP. Tiene prioridad la reunión que se está mirando; las demás se sondean, y el estado trae la misma foto.
- **Con el flujo abierto, esa reunión no se sondea**: una sola estrategia por reunión, como pide el backend.
- **Cortes.** Si el flujo termina sin estado final o pasan 10 segundos sin latidos, se reconecta a los 2 segundos; mientras tanto, el sondeo cubre la reunión. Un rechazo (401, 403, 429, 5xx) espera lo que diga `Retry-After`. Un tercer flujo recibe `429 RequestConcurrencyLimited`, que no penaliza la IP ni pausa el resto de la app.
- **Backend sin progreso en tiempo real** (versión antigua): `/events` responde 404. Se recuerda 5 minutos para no insistir, porque las rutas inexistentes cuentan para el bloqueo por IP, y la interfaz deduce el paso del estado (cola, preparación, fragmentos).
- **404 `MeetingNotFound`**: la reunión ya no existe en el servidor y se marca así en la biblioteca.

## Nombres de las voces

La transcripción trae `speakerId` (identidad estable de la voz, «Hablante 1») y `speaker` (lo que se muestra: el nombre si se presentó, o la etiqueta). Murmur identifica cada voz por `speakerId`, así que los colores y los nombres que pone el usuario no cambian aunque el servidor detecte un nombre. El nombre detectado se muestra por defecto con una marca, y el usuario puede cambiarlo. Las transcripciones antiguas, sin `speakerId`, siguen funcionando como antes.

## Código

| Qué | Dónde |
|---|---|
| Tipos (`MeetingProgressDto`, `ProcessingStage`, `SpeakerIdentityDto`) | `src/api/types.ts` |
| Cliente del flujo (`streamMeeting`) y `getProgress` | `src/api/client.ts` |
| Gestor de flujos y sondeo | `src/state/library.tsx` |
| Pasos, porcentaje y estimación | `src/utils/progress.ts` |
| Pantalla de progreso | `src/components/LiveProgress.tsx` |
| Voces por `speakerId` y nombres detectados | `normalizeTranscript` en `src/utils/transcript.ts` |

El backend simulado (`pnpm dev:mock`) reproduce el contrato: las 12 fases, los latidos cada 2 segundos, eventos partidos en varios bloques y una persona que se presenta. Con `MOCK_NO_EVENTS=1` simula un backend antiguo sin progreso en tiempo real.
