import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('Actual project HTTP API scopes files, conversations, archives and imports to the principal',{timeout:20000},async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'orion-project-api-')),token='project-api-fixture-'.repeat(3),owner='a'.repeat(64),other='b'.repeat(64),id='p_'+'a'.repeat(32),cid='c'.repeat(32);let child;
  try{
    await fs.writeFile(path.join(root,'internal-token'),token);
    child=spawn(process.execPath,['--experimental-strip-types','apps/agent-server/src/index.ts'],{env:{...process.env,ORION_AGENT_STATE:root,ORION_AGENT_PORT:'0'},stdio:['ignore','pipe','pipe']});
    const port=await new Promise((resolve,reject)=>{let output='',errors='';const timer=setTimeout(()=>reject(new Error('server startup timeout')),10000);child.stderr.on('data',d=>errors+=d);child.stdout.on('data',data=>{output+=data;const m=output.match(/loopback (\d+)/);if(m){clearTimeout(timer);resolve(Number(m[1]));}});child.once('exit',code=>{clearTimeout(timer);reject(new Error('server exited '+code+' '+errors));});});
    const api=async(route,body,principal=owner)=>{const response=await fetch('http://127.0.0.1:'+port+route,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'X-Orion-Owner':principal,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,body:await response.json()};};
    assert.equal((await fetch('http://127.0.0.1:'+port+'/projects')).status,401);
    assert.equal((await fetch('http://127.0.0.1:'+port+'/experiences/output',{method:'POST',body:'{}'})).status,401);
    const selfTest=await api('/experiences/output',{});assert.equal(selfTest.status,200);assert.equal(selfTest.body.passed,true);assert.equal(selfTest.body.model_called,false);assert.equal(selfTest.body.sensitive_visible,false);
    assert.equal((await api('/experiences/output',{candidate:'caller supplied output'})).status,400);
    assert.equal((await api('/experiences/output',{},'')).status,403);
    assert.equal((await api('/projects',{id,name:'接口测试'})).status,201);assert.equal((await api('/projects/'+id,undefined,other)).status,403);
    assert.equal((await api('/projects/'+id+'/mkdir',{path:'src'})).status,200);
    assert.equal((await api('/projects/'+id+'/write',{path:'src/test.py',content:'print(1)',beforeHash:null})).status,200);
    const read=await api('/projects/'+id+'/read',{path:'src/test.py'});assert.equal(read.body.content,'print(1)');assert.equal((await api('/projects/'+id+'/read',{path:'src/test.py'},other)).status,403);
    for(const rel of ['../internal-token','/etc/passwd','src/.env'])assert.equal((await api('/projects/'+id+'/read',{path:rel})).status,400);
    assert.equal((await api('/projects/'+id+'/write',{path:'src/test.py',content:'stale',beforeHash:null})).status,409);
    assert.equal((await api('/conversations',{id:cid,project:id})).status,200);assert.equal((await api('/conversations',undefined)).body.conversations[0].project,id);
    const turn={id:'d'.repeat(32),engine:'chat',prompt:'你好',answer:'项目内直接回答',created:new Date().toISOString(),snapshot:{mode:'agent',execution:'answer',access:'read',model:'small',project:id,files:[]}};
    const complete=async(body,attested=true)=>fetch('http://127.0.0.1:'+port+'/conversations/'+cid+'/complete',{method:'POST',headers:{Authorization:'Bearer '+token,'X-Orion-Owner':owner,'Content-Type':'application/json',...(attested?{'X-Orion-Attested':'chat-completed'}:{})},body:JSON.stringify(body)});
    assert.equal((await complete(turn,false)).status,403,'Browser cannot attest completed direct answers');
    assert.equal((await complete(turn)).status,200);
    assert.equal((await api('/conversations/'+cid)).body.turns[0].snapshot.mode,'agent');
    assert.equal((await complete({...turn,id:'e'.repeat(32),snapshot:{...turn.snapshot,project:'demo'}})).status,400,'Project context cannot cross conversation binding');
    assert.equal((await complete({...turn,id:'e'.repeat(32),snapshot:{...turn.snapshot,access:'edit'}})).status,400,'Direct answers cannot claim edit access');
    assert.equal((await complete({...turn,id:'e'.repeat(32),snapshot:{...turn.snapshot,execution:'tools'}})).status,400,'Direct answers cannot claim tool execution');
    assert.equal((await complete({...turn,id:'e'.repeat(32),snapshot:{...turn.snapshot,mode:'ask',project:null}})).status,200,'Older attested clients remain compatible');
    assert.equal((await api('/conversations',{id:cid,project:'demo'})).status,409);assert.equal((await api('/conversations/'+cid,undefined,other)).status,403);
    const preview=await api('/projects/'+id+'/preview',{files:[{path:'note.txt',content:'导入'}]});assert.equal(preview.status,200);assert.equal((await api('/projects/'+id+'/import',{id:preview.body.id})).body.imported,1);
    let project=(await api('/projects/'+id)).body;assert(!Object.hasOwn(project,'owner'));
    assert.equal((await api('/projects/'+id+'/update',{action:'archive',revision:project.revision})).status,200);
    assert(!(await api('/health')).body.projects.some(p=>p.id===id));assert((await api('/projects')).body.projects.some(p=>p.id===id&&p.status==='archived'));
    assert.equal((await api('/projects/'+id+'/write',{path:'x',content:'x',beforeHash:null})).status,409);assert.equal((await api('/projects/'+id+'/export')).body.files.length,2);
    project=(await api('/projects/'+id)).body;assert.equal((await api('/projects/'+id+'/update',{action:'restore',revision:project.revision})).status,200);
    assert.equal((await api('/projects/'+id+'/files')).body.files.length,2);
  }finally{if(child&&child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});}
});
