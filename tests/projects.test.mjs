import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectStore } from '../apps/agent-server/src/projects.ts';
import { projectZip } from '../apps/console/src/features/projects/project-files.ts';

const owner='a'.repeat(64),other='b'.repeat(64),a='p_'+'a'.repeat(32),b='p_'+'b'.repeat(32);
async function fixture(fn){const root=await fs.mkdtemp(path.join(os.tmpdir(),'orion-projects-'));try{const store=new ProjectStore(root);await store.init();await fn(store,root);}finally{assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});}}

test('Project creation persists unique roots, ownership, Unicode names and idempotency',()=>fixture(async(store,root)=>{
  await store.create({id:a,name:'中文比赛项目',description:'仅作背景'},owner);await store.create({id:a,name:'重试'},owner);await store.create({id:b,name:'另一个'},owner);
  await store.write(a,owner,{path:'README.md',content:'甲项目',beforeHash:null});await store.write(b,owner,{path:'README.md',content:'乙项目',beforeHash:null});
  assert.equal((await store.file(a,owner,'README.md')).content,'甲项目');assert.equal((await store.file(b,owner,'README.md')).content,'乙项目');
  await assert.rejects(()=>store.get(a,other),/project_denied/);assert.equal((await store.list(other)).length,1);
  const restored=new ProjectStore(root);await restored.init();assert.equal((await restored.get(a,owner)).name,'中文比赛项目');assert.equal((await restored.list(owner)).length,3);
  assert(!JSON.stringify(await store.list(owner)).includes('owner'));await assert.rejects(()=>store.create({id:'../../etc',name:'逃逸'},owner));
}));

test('Archive and restore retain files and reject writes; metadata edits bind revision',()=>fixture(async store=>{
  await store.create({id:a,name:'归档'},owner);await store.write(a,owner,{path:'keep.txt',content:'保留',beforeHash:null});
  let item=await store.get(a,owner);await store.update(a,owner,{action:'archive',revision:item.revision});
  assert.equal((await store.file(a,owner,'keep.txt')).content,'保留');await assert.rejects(()=>store.write(a,owner,{path:'x',content:'x',beforeHash:null}),/archived/);
  await assert.rejects(()=>store.update(a,owner,{name:'过期',revision:item.revision}),/project_changed/);
  item=await store.get(a,owner);await store.update(a,owner,{action:'restore',revision:item.revision});assert.equal((await store.get(a,owner,true)).status,'active');
}));

test('Folder import previews exclusions, commits safe paths atomically and preserves files',()=>fixture(async(store,root)=>{
  await store.create({id:a,name:'导入'},owner);await store.write(a,owner,{path:'keep.md',content:'旧数据',beforeHash:null});
  const preview=await store.preview(a,owner,[{path:'src/main.py',content:'print(1)'},{path:'../escape',content:'x'},{path:'.env',content:'x'},{path:'keep.md',content:'替换'},{path:'secret.txt',content:'sk-'+'x'.repeat(24)}]);
  assert.equal(preview.files.length,1);assert.equal(preview.skipped.length,4);assert.equal((await store.tree(a,owner)).files.length,1);
  await assert.rejects(()=>store.commit(b,owner,preview.id));await assert.rejects(()=>store.commit(a,other,preview.id),/denied/);
  await store.commit(a,owner,preview.id);assert.equal((await store.file(a,owner,'keep.md')).content,'旧数据');assert.equal((await store.file(a,owner,'src/main.py')).content,'print(1)');
  const exported=await store.export(a,owner);assert.equal(exported.files.length,2);assert(!JSON.stringify(exported).includes(root));await assert.rejects(()=>store.commit(a,owner,preview.id),/import_expired/);
}));

test('Imports refuse stale snapshots, file collisions, capacity and cross-file directory conflicts',()=>fixture(async store=>{
  await store.create({id:a,name:'冲突'},owner);
  const p=await store.preview(a,owner,[{path:'a',content:'一'},{path:'a/b',content:'二'},{path:'oversize.txt',content:'x'.repeat(32769)},{path:'ok.txt',content:'完成'}]);assert.equal(p.files.length,2);assert.equal(p.skipped.length,2);
  await store.write(a,owner,{path:'changed.txt',content:'并发修改',beforeHash:null});await assert.rejects(()=>store.commit(a,owner,p.id),/stale_import/);
  assert.deepEqual((await store.tree(a,owner)).files,['changed.txt']);
  await assert.rejects(()=>store.write(a,owner,{path:'changed.txt',content:'覆盖',beforeHash:null}),/stale_approval/);
  const before=await store.file(a,owner,'changed.txt');await store.write(a,owner,{path:'changed.txt',content:'人工修改',beforeHash:before.hash});assert.equal((await store.file(a,owner,'changed.txt')).content,'人工修改');
}));

test('Directory creation requires an existing parent and exact unused safe path',()=>fixture(async store=>{
  await store.create({id:a,name:'目录'},owner);await assert.rejects(()=>store.mkdir(a,owner,'src/deep'));
  await store.mkdir(a,owner,'src');await store.mkdir(a,owner,'src/deep');await assert.rejects(()=>store.mkdir(a,owner,'src'),/path_exists/);
  await store.write(a,owner,{path:'src/deep/main.py',content:'print(1)',beforeHash:null});assert((await store.tree(a,owner)).entries.some(e=>e.path==='src/deep'&&e.kind==='directory'));
  for(const rel of ['../outside','/tmp/file','C:/file','.git/config','src/.env'])await assert.rejects(()=>store.mkdir(a,owner,rel),/path_denied/);
}));

test('Agent workspace mutations cannot bypass storage limits or an archived project',()=>fixture(async store=>{
  await store.create({id:a,name:'容量边界'},owner);const workspace=store.workspace(a,owner);
  for(let i=0;i<32;i++)await store.write(a,owner,{path:`file-${i}.txt`,content:'x'.repeat(32768),beforeHash:null});
  await assert.rejects(async()=>workspace.apply(await workspace.proposal('overflow.txt','x')),/project_storage_limit/);assert(!(await store.tree(a,owner)).files.includes('overflow.txt'));
  const item=await store.get(a,owner);await store.update(a,owner,{action:'archive',revision:item.revision});
  await assert.rejects(async()=>workspace.createDirectory(await workspace.directoryProposal('newdir')),/project_archived/);
}));

test('Interrupted import restores the old directory on service restart without moving demo',()=>fixture(async(store,root)=>{
  await store.create({id:a,name:'恢复'},owner);await store.write(a,owner,{path:'keep.txt',content:'原文件',beforeHash:null});
  const id='11111111-1111-4111-8111-111111111111',dir=path.join(root,'project-imports',id);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify({project:a}));await fs.rename(store.directory(a),path.join(dir,'before'));
  const restored=new ProjectStore(root);await restored.init();assert.equal((await restored.file(a,owner,'keep.txt')).content,'原文件');assert.equal((await restored.get('demo',owner)).source,'legacy');
}));

test('ZIP export preserves UTF-8 paths, file bytes and empty directories with CRC32',()=>{
  const zip=projectZip([{path:'中文/a.txt',content:'hello'}],['中文','empty']);const data=new DataView(zip.buffer);let position=0;const names=[];
  while(data.getUint32(position,true)===0x04034b50){const size=data.getUint32(position+18,true),length=data.getUint16(position+26,true);const name=new TextDecoder().decode(zip.slice(position+30,position+30+length));names.push(name);if(name.endsWith('a.txt')){assert.equal(data.getUint32(position+14,true),0x3610a686);assert.equal(new TextDecoder().decode(zip.slice(position+30+length,position+30+length+size)),'hello');}position+=30+length+size;}
  assert.deepEqual(names,['中文/','empty/','中文/a.txt']);assert.equal(data.getUint32(zip.length-22,true),0x06054b50);assert.equal(data.getUint16(zip.length-14,true),3);
});
