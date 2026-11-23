import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {ConversationStore} from '../apps/agent-server/src/conversations.ts';

test('Real event endpoint enforces token and conversation owner, then restores an archived run', {timeout:20000}, async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'orion-events-')),token='fixture-token-'.repeat(4);
 const id='11111111-1111-4111-8111-111111111111',cid='a'.repeat(32),tid='b'.repeat(32);
 let child;
 try{
  await fs.mkdir(path.join(root,'runs'));await fs.writeFile(path.join(root,'internal-token'),token);
  const store=new ConversationStore(path.join(root,'conversations')),conversation=store.ensure(cid,'c'.repeat(64));conversation.runIds.push(id);store.save(conversation);
  const created=new Date().toISOString(),meta={id,project:'demo',model:'auto',access:'read',created,conversationId:cid,turnId:tid,files:[]};
  const events=[{seq:1,type:'created',at:created,data:meta},{seq:2,type:'answer_delta',at:created,data:{message:1,text:'恢复的回答'}},{seq:3,type:'answer',at:created,data:{message:1,text:'恢复的回答'}},{seq:4,type:'state',at:created,data:{phase:'completed'}}];
  await fs.writeFile(path.join(root,'runs',id+'.jsonl'),events.map(e=>JSON.stringify(e)).join('\n')+'\n');
  child=spawn(process.execPath,['--experimental-strip-types','apps/agent-server/src/index.ts'],{cwd:process.cwd(),env:{...process.env,ORION_AGENT_STATE:root,ORION_AGENT_PORT:'0'},stdio:['ignore','pipe','pipe']});
  const port=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error('fixture server not ready')),10000);child.stdout.on('data',data=>{output+=data;const m=output.match(/loopback (\d+)/);if(m){clearTimeout(timer);resolve(Number(m[1]));}});child.once('exit',code=>{clearTimeout(timer);reject(new Error('fixture server exited '+code));});});
  const url=`http://127.0.0.1:${port}/runs/${id}/events`;
  assert.equal((await fetch(url)).status,401);
  const denied=await fetch(url,{headers:{Authorization:'Bearer '+token,'X-Orion-Owner':'d'.repeat(64)}});assert.equal(denied.status,403);assert(!(await denied.text()).includes('恢复'));
  const response=await fetch(url,{headers:{Authorization:'Bearer '+token,'X-Orion-Owner':'c'.repeat(64)}});assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/ndjson/);
  const frames=(await response.text()).trim().split('\n').map(JSON.parse);assert.equal(frames.length,1);assert.equal(frames[0].event,'snapshot');assert.equal(frames[0].run.phase,'completed');assert.equal(frames[0].run.events[2].data.text,'恢复的回答');
 }finally{
  if(child&&child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}
  assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});
 }
});
