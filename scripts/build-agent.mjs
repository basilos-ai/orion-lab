import { build } from 'esbuild';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
await build({ entryPoints: [path.join(root,'apps/agent-server/src/index.ts')], outfile: path.join(root,'dist-agent/server.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24', external: ['@earendil-works/*', 'typebox'], sourcemap: false });
