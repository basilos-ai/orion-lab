import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, resolveConfig } from 'vite';
import { serviceUrl } from '../apps/console/src/lib/config.ts';
import { gatewayDisplayText, legacyGatewayBaseKey, legacyGatewayName } from '../apps/console/src/lib/gateway-brand.ts';

const appRoot = fileURLToPath(new URL('../apps/console/', import.meta.url));
const configFile = fileURLToPath(new URL('../apps/console/vite.config.ts', import.meta.url));

test('Vite routes monitor and streaming chat separately while local navigation and production origins remain correct', async t => {
  const requests = [];
  async function upstream(name) {
    const server = createHttpServer((request, response) => {
      requests.push({ name, path: request.url, host: request.headers.host, origin: request.headers.origin });
      if (request.url === '/api/chat') {
        response.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        response.write('{"event":"token","text":"中文"}\n');
        response.end('{"event":"done"}\n');
      } else {
        response.writeHead(200, { 'Content-Type': 'application/json', ...(request.url === '/api/session' ? { 'Set-Cookie': 'fixture_session=local; HttpOnly; SameSite=Strict; Path=/' } : {}) });
        response.end(JSON.stringify({ source: name, path: request.url }));
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    return `http://127.0.0.1:${server.address().port}`;
  }
  const dashboard = await upstream('dashboard'), chat = await upstream('chat');
  const prior = { ...process.env };
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key]; Object.assign(process.env, prior); });
  process.env.O6N_DEV_API_TARGET = chat;
  process.env.O6N_DEV_STATUS_TARGET = dashboard;
  delete process.env.O6N_DEV_RESOURCES_TARGET;
  delete process.env.O6N_PUBLIC_CONFIG;
  const server = await createServer({ root: appRoot, configFile, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] }, server: { host: '127.0.0.1', port: 0, strictPort: false } });
  t.after(() => server.close());
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  assert.equal((await (await fetch(origin + '/api/resources?fresh=1')).json()).source, 'dashboard');
  assert.equal((await (await fetch(origin + '/api/status')).json()).source, 'dashboard');
  assert.equal((await (await fetch(origin + '/api/health')).json()).source, 'chat');
  const session = await fetch(origin + '/api/session');
  assert.match(session.headers.get('set-cookie'), /fixture_session=local; HttpOnly; SameSite=Strict; Path=\//);
  const stream = await fetch(origin + '/api/chat', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(await stream.text(), '{"event":"token","text":"中文"}\n{"event":"done"}\n');
  assert.equal(requests.at(-1).name, 'chat');
  assert.equal(requests.at(-1).origin, origin);
  assert.equal(requests.at(-1).host, new URL(origin).host);
  const settings = JSON.parse(server.config.define.__O6N_CONFIG__);
  const address = { protocol: 'http:', hostname: '127.0.0.1', href: origin + '/' };
  assert.equal(serviceUrl('chat', settings, address).href, origin + '/chat.html');
  assert.equal(serviceUrl('dashboard', settings, address).href, origin + '/');
  const production = await resolveConfig({ root: appRoot, configFile, logLevel: 'silent' }, 'build', 'production');
  const productionSettings = JSON.parse(production.define.__O6N_CONFIG__);
  assert.equal(serviceUrl('chat', productionSettings, address).port, '17790');
  assert.equal(serviceUrl('dashboard', productionSettings, address).port, '17780');
  assert.equal(serviceUrl('gateway', productionSettings, address).port, '13000');
  assert.equal(gatewayDisplayText(`请求被 ${legacyGatewayName.toLowerCase()} 输入保护拦截。`), '请求被 AI Gateway 输入保护拦截。');

  const configFolder = await mkdtemp(join(tmpdir(), 'orion-gateway-config-'));
  t.after(() => rm(configFolder, { recursive: true, force: true }));
  process.env.O6N_PUBLIC_CONFIG = join(configFolder, 'public.json');
  const originalGateway = 'http://legacy-gateway.test:13001/';
  const currentGateway = 'http://current-gateway.test:13002/';
  await writeFile(process.env.O6N_PUBLIC_CONFIG, JSON.stringify({ [legacyGatewayBaseKey]: originalGateway }));
  const legacy = await resolveConfig({ root: appRoot, configFile, logLevel: 'silent' }, 'build', 'production');
  const legacySettings = JSON.parse(legacy.define.__O6N_CONFIG__);
  assert.equal(serviceUrl('gateway', legacySettings, address).href, originalGateway);
  assert(!Object.hasOwn(legacySettings, legacyGatewayBaseKey));
  await writeFile(process.env.O6N_PUBLIC_CONFIG, JSON.stringify({ [legacyGatewayBaseKey]: originalGateway, gatewayBase: currentGateway }));
  const updated = await resolveConfig({ root: appRoot, configFile, logLevel: 'silent' }, 'build', 'production');
  assert.equal(serviceUrl('gateway', JSON.parse(updated.define.__O6N_CONFIG__), address).href, currentGateway);
});
