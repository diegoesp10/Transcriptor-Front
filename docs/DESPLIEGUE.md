# Entornos y despliegue

Murmur tiene dos formas de ejecutarse:

| | Desarrollo | Producción |
|---|---|---|
| Comando | `pnpm dev` | `pnpm build` y después `pnpm start`, o la imagen Docker |
| Quién sirve la web | Vite, con recarga en caliente | `server/index.mjs` (Node, sin dependencias) |
| Proxy hacia el backend | El de Vite (`vite.config.ts`) | El del propio servidor |
| Configuración | `.env.development` (en el repositorio) y `.env.development.local` (tuyo) | Variables de entorno de la plataforma donde se publique |
| Marca en la barra lateral | «Desarrollo» | Ninguna (o «Preproducción» con `APP_ENV=staging`) |

En los dos casos el navegador solo habla con su propio origen: `/api` y `/health` los reenvía el proxy al backend **añadiendo la clave**. La clave nunca forma parte del JavaScript que se descarga el navegador.

## Desarrollo

```bash
pnpm install
pnpm dev          # contra tu backend local (BACKEND_URL de .env.development)
pnpm dev:mock     # contra el backend simulado, sin necesitar el real
```

`.env.development` se sube al repositorio con valores por defecto: el backend local en `https://localhost:52610` y la clave **pública de desarrollo** del backend. Para cambiar algo solo en tu equipo, crea `.env.development.local` (no se sube y tiene prioridad).

Vite lee los archivos en este orden, de más a menos prioridad: variables del sistema, `.env.development.local`, `.env.development`, `.env.local` y `.env`.

## Producción

### Configuración

Todo se configura con **variables de entorno al arrancar**, no al compilar. Una misma compilación (o una misma imagen) sirve para preproducción y producción. La plantilla con todas las variables está en [.env.production.example](../.env.production.example).

| Variable | Obligatoria | Para qué |
|---|---|---|
| `BACKEND_URL` | sí | URL del backend tal como la ve el servidor; puede llevar ruta base (`https://api.interna/transcriber`). |
| `BACKEND_API_KEY` | sí | Clave del backend (`Security:ApiKey`). **Secreto**: guárdala en el gestor de secretos de la plataforma. No se acepta la clave de desarrollo. |
| `APP_ENV` | no (`production`) | Nombre del entorno. Cualquier otro valor (`staging`, `test`) muestra una marca en la interfaz. |
| `PORT` / `HOST` | no (`8080` / `0.0.0.0`) | Dónde escucha el servidor. |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` | no | Usuario y contraseña para toda la web. Recomendado si no hay otro inicio de sesión delante. |
| `BACKEND_ALLOW_SELF_SIGNED` | no (`false`) | Acepta un certificado propio en un backend interno. Nunca contra uno público. |
| `HSTS_MAX_AGE` | no (`0`) | Activa HSTS (en segundos) cuando la web se sirve siempre por HTTPS. |
| `MAX_UPLOAD_MB` | no (`2000`) | Rechaza antes de reenviar las subidas más grandes. |
| `LOG_REQUESTS` | no (`true`) | Una línea por petición: método, ruta, estado y tiempo. Nunca la query, que lleva nombres de archivo. |

El servidor comprueba la configuración al arrancar y **no se inicia** si falta algo obligatorio, si se usa la clave de desarrollo en producción o si falta la contraseña de la autenticación básica. Avisa también si el backend va por `http://` fuera de una red privada y si la web queda sin protección.

Solo hay una variable que se fija al compilar: `VITE_MAX_FILE_MB`, el tamaño máximo que acepta la interfaz antes de subir (2000 por defecto).

### Opción 1: Node

En cualquier máquina con Node 22.12 o superior:

```bash
pnpm install --frozen-lockfile
pnpm build
# variables de entorno de la plataforma, o un archivo .env.production en la carpeta (no se sube al repositorio)
pnpm start
```

`pnpm start` lee `.env.production` si existe; las variables del sistema tienen prioridad sobre el archivo. Para el despliegue solo hacen falta `dist/`, `server/` y `package.json`: el servidor no tiene dependencias, así que no hace falta `node_modules` en la máquina de destino.

### Opción 2: Docker

```bash
docker build -t murmur .
docker run -d -p 8080:8080 \
  -e BACKEND_URL=https://api.interna.example.com \
  -e BACKEND_API_KEY=… \
  murmur
```

O con Compose, a partir de la plantilla:

```bash
cp .env.production.example .env.production   # y rellénalo
docker compose up -d --build
```

La imagen compila la web en una primera fase y solo copia el resultado a la imagen final (`node:22-alpine`, usuario sin privilegios, sistema de archivos de solo lectura en Compose). Incluye un `HEALTHCHECK` contra `/healthz`. Si el backend corre en la misma máquina fuera de Docker, usa `BACKEND_URL=http://host.docker.internal:52611`.

### Opción 3: tu propio PC con IIS y Docker

Es el montaje que prepara el backend (su `docs/DOCKER.md`): un Compose con el frontal, la API y Ollama, e IIS delante con el certificado.

```text
Internet ──HTTPS 443──> IIS (URL Rewrite + ARR) ──HTTP──> 127.0.0.1:8090 frontal (Docker) ──> API + motores (Docker)
```

- El Compose del backend construye **este** repositorio con su `Dockerfile` (`FRONTEND_PATH`), y su `Initialize-Docker.ps1` genera la clave común y el usuario y contraseña de la web (`deploy/docker/frontend.production.env`).
- IIS sobrescribe `X-Murmur-Client-IP` con la IP del visitante. Este servidor la reenvía al backend solo si la petición llega desde la red privada (IIS → Docker); desde cualquier otra IP la sustituye por la de la conexión, para que nadie se salte los límites. El nombre se cambia con `CLIENT_IP_HEADER`.
- El progreso en directo pasa por ARR: hay que poner su *Response buffer threshold* a 0 y desactivar la compresión dinámica (la plantilla `deploy/iis/web.config.example` del backend ya desactiva la de IIS).

Para abrirlo a Internet desde casa, además:

1. **IP pública**: comprueba que tu operador no usa CG-NAT (la IP WAN del router tiene que coincidir con la que ves en un «cuál es mi IP»). Con CG-NAT, la redirección de puertos no funciona: pide una IP pública al operador o usa un túnel.
2. **Nombre**: un dominio propio con un registro A a tu IP, o un DNS dinámico (DuckDNS, No-IP) si tu IP cambia.
3. **Router**: IP fija para el PC (reserva DHCP) y redirección de los puertos TCP 443 y 80 hacia él. El 80 solo sirve para validar el certificado y redirigir a HTTPS.
4. **Certificado**: Let's Encrypt con win-acme, que crea el binding HTTPS en IIS y lo renueva solo.
5. **Firewall de Windows**: entrada 80 y 443 para IIS. Nada más: ni SQL Server, ni Docker, ni el 8090.
6. **Acceso**: deja activadas `BASIC_AUTH_USER` y `BASIC_AUTH_PASSWORD`; la web es la única puerta a la API.
7. **El PC encendido**: sin suspensión, y con Docker Desktop arrancando al iniciar sesión (Docker Desktop no corre sin una sesión de usuario abierta).
8. **Prueba desde fuera**: con el móvil sin wifi.

Si usas un túnel (Cloudflare Tunnel, ngrok…) en vez de abrir puertos, revisa sus límites antes. Cloudflare en el plan gratuito corta las subidas de más de 100 MB y las respuestas que tardan más de 100 segundos (un resumen puede tardar más). Además, `{REMOTE_ADDR}` en IIS pasaría a ser la IP del túnel, no la del visitante.

### Plataformas gestionadas

Cualquier servicio que ejecute un contenedor o una aplicación Node vale (Azure App Service, Azure Container Apps, AWS App Runner o ECS, Google Cloud Run, Kubernetes, un servicio de Windows…):

1. Publica la imagen Docker, o `dist/` + `server/` + `package.json` con el comando de arranque `node server/index.mjs`.
2. Define `BACKEND_URL` como variable y `BACKEND_API_KEY` como secreto.
3. Comprobación de vida: `GET /healthz`. Comprobación de disponibilidad: `GET /readyz` (responde 503 si no llega al backend).
4. Pon el puerto que espera la plataforma en `PORT`.

## Delante del servidor: HTTPS

El servidor habla HTTP. Pon delante el HTTPS de la plataforma o un proxy (nginx, Caddy, Traefik, un balanceador). Grabar con el micrófono y elegir una carpeta solo funcionan con HTTPS. El proxy de delante tiene que:

- dejar pasar cuerpos grandes (subidas de hasta 2 GB) y en streaming;
- no almacenar en búfer las respuestas `text/event-stream` de `/api/meetings/{id}/events` (progreso en directo);
- no cortar peticiones largas: el resumen puede tardar varios minutos.

Ejemplo de nginx delante del servidor de Murmur:

```nginx
server {
    listen 443 ssl;
    server_name murmur.example.com;
    # ssl_certificate y ssl_certificate_key…

    client_max_body_size 2g;
    proxy_request_buffering off;
    proxy_buffering off;
    proxy_read_timeout 1h;
    proxy_send_timeout 1h;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

Con HTTPS asegurado en todas las rutas, activa `HSTS_MAX_AGE=31536000`.

## Qué hace el servidor de producción

- Sirve `dist/` desde memoria, ya comprimido (brotli y gzip), con `ETag`. Los archivos de `/assets/` (con hash en el nombre) llevan caché de un año; `index.html` se revalida siempre, así que un despliegue nuevo se ve al recargar.
- Reenvía `/api/*` y `/health` al backend. Quita la `X-Api-Key`, `Authorization` y `Cookie` que vengan del navegador y pone la suya. Las subidas y las respuestas pasan en streaming, sin cargarse en memoria. El progreso en directo sale sin búfer. Si el navegador cancela, corta también la petición al backend.
- Añade cabeceras de seguridad: CSP (con el hash del único script en línea), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer` y una `Permissions-Policy` que solo permite el micrófono y mantener la pantalla encendida a la propia web.
- `/healthz` y `/readyz` no piden autenticación; todo lo demás sí, si está configurada.
- Al recibir `SIGTERM` deja de aceptar conexiones, cierra los flujos de progreso (el navegador reconecta solo con la nueva instancia) y sale.

## Límites del backend detrás del proxy

El backend limita las peticiones **por IP de conexión** y no se fía de `X-Forwarded-For` (lo documenta así). Detrás de este servidor, todas las peticiones llegan desde su IP: todos los usuarios comparten un mismo presupuesto (60 lecturas por minuto por endpoint, 1 subida simultánea…). Murmur ya va por debajo con un usuario, pero con varios usuarios a la vez hay que:

- configurar en el backend este servidor como proxy de confianza para que use la IP real de cada usuario (el servidor ya envía `X-Forwarded-For`), o
- subir los límites por IP del backend para la IP de este servidor.

## Lista de comprobación antes de publicar

- [ ] `BACKEND_API_KEY` de producción guardada como secreto, distinta de la de desarrollo.
- [ ] HTTPS delante, y `HSTS_MAX_AGE` activado si todo va por HTTPS.
- [ ] Acceso protegido: `BASIC_AUTH_*` o un inicio de sesión en el proxy o la plataforma.
- [ ] Límites por IP del backend revisados para el tráfico que llega a través del proxy.
- [ ] `/readyz` responde 200 desde la plataforma (llega al backend).
- [ ] El proxy de delante no almacena en búfer `text/event-stream` y deja pasar 2 GB.
- [ ] `pnpm api:check https://…` contra el backend de producción (si publica su OpenAPI).
