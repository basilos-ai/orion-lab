import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'), target=path.join(root,'.runtime','agent-release');
if(!existsSync(path.join(root,'dist-agent/server.mjs')))throw new Error('Run npm run build:agent first');
if(path.dirname(target)!==path.join(root,'.runtime'))throw new Error('Invalid staging target');
rmSync(target,{recursive:true,force:true});mkdirSync(target,{recursive:true});
cpSync(path.join(root,'dist-agent/server.mjs'),path.join(target,'server.mjs'));
for(const name of ['package.json','package-lock.json'])cpSync(path.join(root,'deploy/o6n/agent-runtime',name),path.join(target,name));
console.log('Prepared .runtime/agent-release; run npm ci --omit=dev --ignore-scripts on the target host.');
