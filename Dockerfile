# syntax=docker/dockerfile:1
#
# Imagen de producción de Murmur: compila la web y la sirve con server/index.mjs (Node, sin dependencias).
# La configuración (backend, clave, entorno…) se pasa al arrancar con variables de entorno, no al compilar:
#
#   docker build -t murmur .
#   docker run -p 8080:8080 -e BACKEND_URL=https://api.interna -e BACKEND_API_KEY=… murmur
#
# Ver .env.production.example y docs/DESPLIEGUE.md.

# ── Compilación ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable

# Primero solo las dependencias, para aprovechar la caché de capas
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
# Opcional: límite por archivo en la interfaz (MB). Es lo único que se fija al compilar.
ARG VITE_MAX_FILE_MB=2000
ENV VITE_MAX_FILE_MB=${VITE_MAX_FILE_MB}
RUN pnpm build

# ── Ejecución ─────────────────────────────────────────────────────────────────
FROM node:22-alpine
ENV NODE_ENV=production \
    APP_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0
WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server

# Sin privilegios: el usuario «node» viene en la imagen oficial
USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]
