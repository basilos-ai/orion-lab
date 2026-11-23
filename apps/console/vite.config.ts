import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { legacyGatewayBaseKey } from './src/lib/gateway-brand.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const dataDirectory = process.env.O6N_DATA_DIR;
const outDirectory = process.env.O6N_BUILD_DIR ? path.resolve(process.env.O6N_BUILD_DIR) : path.join(root, '../../dist');
const rawSettings = process.env.O6N_PUBLIC_CONFIG ? JSON.parse(fs.readFileSync(process.env.O6N_PUBLIC_CONFIG, 'utf8')) : {};
const allowed = ['chatBase', 'dashboardBase', 'gatewayBase', legacyGatewayBaseKey, 'layaBase', 'deviceName', 'deviceSummary'];
if (Object.keys(rawSettings).some(key => !allowed.includes(key))) throw new Error('Only public deployment options are allowed.');
const { [legacyGatewayBaseKey]: previousGatewayBase, ...settings } = rawSettings;
if (!Object.hasOwn(settings, 'gatewayBase') && previousGatewayBase !== undefined) {
  settings.gatewayBase = previousGatewayBase;
}
const developmentProxy = process.env.O6N_DEV_API_TARGET ? {
  '/api/resources': { target: process.env.O6N_DEV_RESOURCES_TARGET || process.env.O6N_DEV_STATUS_TARGET || process.env.O6N_DEV_API_TARGET, changeOrigin: false },
  '/api/status': { target: process.env.O6N_DEV_STATUS_TARGET || process.env.O6N_DEV_API_TARGET, changeOrigin: false },
  '/api/': { target: process.env.O6N_DEV_API_TARGET, changeOrigin: false },
} : undefined;

export default defineConfig(({ command, isPreview }) => ({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.join(root, 'src') } },
  base: './',
  define: { __O6N_CONFIG__: JSON.stringify({
    ...(command === 'serve' && !isPreview ? { chatBase: '/chat.html', dashboardBase: '/' } : {}),
    ...settings,
    demo: process.env.O6N_RUNTIME_MODE !== 'live' && !dataDirectory,
  }) },
  build: {
    target: 'es2022',
    outDir: outDirectory, emptyOutDir: true,
    rollupOptions: { input: { dashboard: path.join(root, 'index.html'), chat: path.join(root, 'chat.html') } },
  },
  server: { host: '127.0.0.1', port: 17880, strictPort: true, proxy: developmentProxy },
  preview: { host: '127.0.0.1', port: 17880, strictPort: true, proxy: developmentProxy },
}));
