import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { Workspace, relativePath, safeText } from '../packages/tool-runner/src/index.ts';
import {parseDecisionEngine} from '../packages/contracts/src/decision-engines.ts';
import { parseAgentRequest } from '../packages/contracts/src/agent.ts';
import { nativeHookSource, BridgeClient } from '../packages/gateway-adapter/src/index.ts';
import { agentRoute } from '../packages/model-router/src/index.ts';
import { AgentRun } from '../packages/agent-runtime/src/index.ts';

test('Agent contract rejects arbitrary models/projects; no false native source', () => {
  assert.equal(parseAgentRequest({ project: 'demo', model: 'auto', prompt: '读取 README.md' }).model, 'auto');
  for (const input of [{ project: '../secret', model: 'auto', prompt: 'x' }, { project: 'demo', model: 'large', prompt: 'x' }, { project: 'demo', model: 'cloud', prompt: '' }]) assert.throws(() => parseAgentRequest(input));
  assert.throws(() => nativeHookSource(['codex','claude_code']), /unsupported/); assert.equal(nativeHookSource(['pi']), 'pi');
  assert.equal(agentRoute('auto'), 'standard'); assert.equal(agentRoute('cloud','hybrid'), 'cloud');
  assert.equal(agentRoute('auto','hybrid','cloud'),'cloud');
  assert.throws(()=>agentRoute('auto','local','cloud'),/cloud_scope_required/);
  assert.throws(()=>parseAgentRequest({project:'demo',model:'cloud',scope:'local',prompt:'x'}),/cloud_scope_required/);
  assert.equal(parseAgentRequest({project:'demo',model:'auto',prompt:'x'}).scope,'local');
  assert.throws(()=>parseAgentRequest({project:'demo',model:'auto',scope:'other',prompt:'x'}),/invalid_scope/);
  assert.equal(parseAgentRequest({project:'demo',model:'auto',prompt:'最终只输出JSON：{"result":数值}'}).output.format,'json');
  assert.equal(parseAgentRequest({project:'demo',model:'auto',prompt:'解释JSON的用途'}).output.format,'text');
  assert.equal(parseAgentRequest({project:'demo',model:'auto',prompt:'x',output:{format:'json',schema:{type:'object',properties:{n:{type:'integer'}},required:['n'],additionalProperties:false}}}).output.format,'json');
  for(const output of [{format:'xml'},{format:'text',schema:{type:'object'}},{format:'json',schema:{type:'object',required:['missing']}}])assert.throws(()=>parseAgentRequest({project:'demo',model:'auto',prompt:'x',output}),/invalid_output/);
});
test('Policy bridge rejects denial, malformed verdict and transport failure at every hook stage', async () => {
  const server=createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;const b=JSON.parse(raw);res.setHeader('Content-Type','application/json');if(b.content==='offline'){res.statusCode=503;res.end(JSON.stringify({code:'guard_unavailable'}));}else res.end(JSON.stringify({verdict:b.content}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const bridge=new BridgeClient('http://127.0.0.1:'+server.address().port,'fixture');
    for(const stage of ['UserPromptSubmit','PreToolUse','PostToolUse']) {
      await assert.rejects(bridge.check('fixture',stage,'deny'),/policy_blocked/);
      await assert.rejects(bridge.check('fixture',stage,'unchecked'),/policy_blocked/);
      await assert.rejects(bridge.check('fixture',stage,'offline'),/guard_unavailable/);
      assert.equal((await bridge.check('fixture',stage,'allow')).verdict,'allow');
    }
  } finally {await new Promise(resolve=>server.close(resolve));}
});
test('Tool paths deny escape, secrets, symlinks and hard links; writes bind original hash', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'orion-tools-'));
  try {
    const workspace = new Workspace(root, path.join(root,'scratch'));
    for (const p of ['../a','/etc/passwd','C:/a','a\\b','.env','sub/.ssh/key','auth.json','id.key','a/../b']) assert.throws(() => relativePath(p));
    assert.throws(() => safeText('sk-' + 'x'.repeat(24)), /sensitive/);
    await fs.writeFile(path.join(root,'demo.py'),'print(1)\n');
    const proposal = await workspace.proposal('demo.py','print(2)\n');
    await fs.writeFile(path.join(root,'demo.py'),'print(3)\n');
    await assert.rejects(workspace.apply(proposal), /stale_approval/);
    assert.equal(await workspace.read('demo.py'),'print(3)\n');
    await fs.link(path.join(root,'demo.py'),path.join(root,'linked.py'));
    await assert.rejects(workspace.read('linked.py'), /linked_path/);
    await fs.unlink(path.join(root,'linked.py'));
    try { await fs.symlink(path.join(root,'demo.py'),path.join(root,'symbol.py')); await assert.rejects(workspace.read('symbol.py'), /linked_path/); } catch(e) { if (!['EPERM','EACCES'].includes(e.code)) throw e; }
    await workspace.apply(await workspace.proposal('new.py','print(4)\n')); assert.equal(await workspace.read('new.py'),'print(4)\n');
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});
test('Approval is bound to one run and digest, consumes once, and cancellation resolves pending approval', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'orion-approval-'));await fs.mkdir(path.join(root,'runs'));
  try {
    const run=new AgentRun('demo','auto',new BridgeClient('http://127.0.0.1:17794','fixture'),new Workspace(root,path.join(root,'scratch')),root,'fixture','edit');
    const pending=run.confirm('write_file',{path:'demo.py',content:'x'},'修改','preview');const a=run.approval;
    assert.throws(()=>run.approve(a.id,'wrong',true),/stale_approval/);assert.equal(run.phase,'awaiting_approval');
    run.approve(a.id,a.digest,true);assert.throws(()=>run.approve(a.id,a.digest,true),/stale_approval/);await pending;
    const cancelled=run.confirm('run_check',{kind:'python_tests'},'检查','preview');run.cancel();await assert.rejects(cancelled);
    assert.equal(run.approval,undefined);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});
test('Actual Pi SDK completes a tool loop; only explicit tools and policy bridge; approval cannot replay', { timeout: 30000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'orion-pi-')); await fs.mkdir(path.join(root,'runs')); await fs.mkdir(path.join(root,'project')); await fs.writeFile(path.join(root,'project','README.md'),'Orion fixture project.');
  let requests=0, ended=false, providerFinished=false, earlyDelta=false; const stages=[];
  const server=createServer(async(req,res)=>{
    let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw||'{}');
    res.setHeader('Content-Type','application/json');
    if(req.url==='/hooks/check'){stages.push(body.stage);return res.end(JSON.stringify({verdict:'allow',policy:'fixture',elapsed_ms:1}));}
    if(req.url==='/agent/start')return res.end(JSON.stringify({lease:'fixture-lease',selected:'standard',reason:'fixture'}));
    if(req.url==='/agent/end'){ended=true;return res.end('{}');}
    if(req.url==='/v1/chat/completions'){
      requests++; assert.deepEqual(body.tools.map(t=>t.function.name).sort(),['create_directory','list_files','read_file','run_check','search_files','write_file']);
      assert(JSON.stringify(body.messages).includes('上一轮的项目代号是蓝鲸'),'Completed conversational context must actually reach Pi model requests');
      const toolResult=body.messages.find(m=>m.role==='tool');
      res.setHeader('Content-Type','text/event-stream');
      const delta=toolResult?{content:'项目用途已读取。'.repeat(12)}:{tool_calls:[{index:0,id:'call_read',type:'function',function:{name:'read_file',arguments:'{"path":"README.md"}'}}]};
      res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'standard',choices:[{index:0,delta,finish_reason:null}]})+'\n\n');
      if(toolResult)await new Promise(resolve=>setTimeout(resolve,80));
      providerFinished=Boolean(toolResult);
      res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'standard',choices:[{index:0,delta:{},finish_reason:toolResult?'stop':'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}})+'\n\n');res.end('data: [DONE]\n\n');return;
    }
    res.statusCode=404;res.end('{}');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  try {
    const run=new AgentRun('demo','auto',new BridgeClient(origin,'fixture-token'),new Workspace(path.join(root,'project'),path.join(root,'scratch')),root,'fixture-token','edit',origin+'/v1');
    run.setContext('a'.repeat(32),'b'.repeat(32),[{role:'user',content:'上一轮的项目代号是蓝鲸'},{role:'assistant',content:'已记住蓝鲸'}],['README.md']);
    run.onEvent(e=>{if(e.type==='answer_delta'&&!providerFinished)earlyDelta=true;});
    run.setPrompt('读取 README.md，说明用途。');await run.start();
    assert(earlyDelta,'Real Pi must emit text while provider is still generating');assert(run.events.filter(e=>e.type==='answer_delta').length>=2);
    assert.equal(run.phase,'completed',JSON.stringify(run.events));assert.equal(requests,2);assert.ok(ended);
    assert.deepEqual(stages,['UserPromptSubmit','PreToolUse','PostToolUse']);
    assert.ok(run.events.some(e=>e.type==='tool_end' && e.data.result.includes('Orion fixture')));assert.ok(run.events.some(e=>e.type==='answer'));
    assert.throws(()=>run.approve('old','wrong',true),/stale_approval/);
    const persisted=(await fs.readFile(path.join(root,'runs',run.id+'.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(persisted.length,run.events.length);
  } finally {await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});}
});

test('Auto accepts cloud only with hybrid scope and locks it across real Pi tool rounds', {timeout:30000}, async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'orion-routing-'));await fs.mkdir(path.join(root,'runs'));await fs.mkdir(path.join(root,'project'));await fs.writeFile(path.join(root,'project','README.md'),'Routing fixture');
  let starts=0,models=0,ends=0;const requested=[];
  const server=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}');res.setHeader('Content-Type','application/json');
    if(req.url==='/hooks/check')return res.end(JSON.stringify({verdict:'allow'}));
    if(req.url==='/agent/start'){starts++;if(body.scope==='hybrid')assert.equal(body.decision_engine,'qwen35-4b-houmo');return res.end(JSON.stringify({lease:'fixture',selected:'cloud',reason:'Laya fixture',decision:{source:'laya',recommended:'cloud',scope:body.scope}}));}
    if(req.url==='/agent/telemetry')return res.end(JSON.stringify({events:[{seq:1,type:'format_repair',data:{state:'completed',attempt:1}}].filter(e=>e.seq>body.after)}));
    if(req.url==='/agent/end'){ends++;return res.end('{}');}
    models++;requested.push(body.model);const done=body.messages.some(m=>m.role==='tool');res.setHeader('Content-Type','text/event-stream');
    const delta=done?{content:'已读取'}:{tool_calls:[{index:0,id:'read',type:'function',function:{name:'read_file',arguments:'{"path":"README.md"}'}}]};
    res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'cloud',choices:[{index:0,delta,finish_reason:null}]})+'\n\n');res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'cloud',choices:[{index:0,delta:{},finish_reason:done?'stop':'tool_calls'}]})+'\n\n');res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  try{
    const run=new AgentRun('demo','auto',new BridgeClient(origin,'fixture'),new Workspace(path.join(root,'project'),path.join(root,'scratch')),root,'fixture','read',origin+'/v1');run.setRouting('hybrid','fixture','qwen35-4b-houmo');run.setPrompt('读取 README.md');await run.start();
    assert.equal(run.phase,'completed',JSON.stringify(run.events));assert.equal(starts,1);assert.equal(models,2);assert.deepEqual(requested,['cloud','cloud']);assert.equal(run.scope,'hybrid');assert.equal(run.selected,'cloud');assert.equal(ends,1);
    assert.equal(run.events.filter(e=>e.type==='format_repair').length,1,'Telemetry cursor must not replay format events');
    const local=new AgentRun('demo','auto',new BridgeClient(origin,'fixture'),new Workspace(path.join(root,'project'),path.join(root,'scratch')),root,'fixture','read',origin+'/v1');local.setPrompt('本地任务');await local.start();assert.equal(local.phase,'failed');assert(local.events.some(e=>e.type==='error'&&e.data.code==='cloud_scope_required'));assert.equal(models,2,'Local rejection must precede any provider call');assert.equal(ends,2);
  }finally{await new Promise(resolve=>server.close(resolve));assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});}
});

test('Decision engine IDs are a closed set and legacy requests remain Laya',()=>{
 assert.equal(parseDecisionEngine(undefined),'laya');
 for(const engine of ['laya','qwen35-2b-houmo','qwen35-4b-houmo'])assert.equal(parseAgentRequest({project:'demo',model:'auto',prompt:'x',decision_engine:engine}).decisionEngine,engine);
 for(const engine of ['gliner','http://remote','__proto__',null,{}])assert.throws(()=>parseDecisionEngine(engine),/invalid_decision_engine/);
});
