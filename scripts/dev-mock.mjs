#!/usr/bin/env node
/*
 * Arranca el backend simulado y Vite apuntando a él, a la vez (pnpm dev:mock).
 * El mock usa su propio puerto (5290) para no chocar con la API real, que escucha en 52611/52610.
 */
import { spawn } from 'node:child_process';

const MOCK_PORT = process.env.MOCK_PORT ?? '5290';
// Las variables del proceso tienen prioridad sobre .env.development, así que Vite apunta al mock y no a la API real
const env = { ...process.env, PORT: MOCK_PORT, BACKEND_URL: `http://localhost:${MOCK_PORT}`, BACKEND_API_KEY: 'meeting-transcriber-local-development-key' };

const children = [
  spawn(process.execPath, ['scripts/mock-backend.mjs'], { env, stdio: 'inherit' }),
  // Los argumentos extra van a Vite: pnpm dev:mock --port 5181
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...process.argv.slice(2)], { env, stdio: 'inherit' }),
];

const stop = () => children.forEach((child) => child.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) child.on('exit', stop);
