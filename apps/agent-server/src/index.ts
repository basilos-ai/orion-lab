import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { AgentRun, outputProtectionSelfTest } from '@orion/agent-runtime';
import { BridgeClient } from '@orion/gateway-adapter';
import { Workspace } from '@orion/tool-runner';
import { parseAgentRequest, conversationId, contextMessages, type AgentHealth, type CompletedTurn } from '@orion/contracts';
import { ConversationStore } from './conversations.ts';
import { ProjectStore } from './projects.ts';

const root = process.env.ORION_AGENT_STATE;
if (!root || !path.isAbsolute(root)) throw new Error('ORION_AGENT_STATE required');
await fs.mkdir(path.join(root, 'runs'), { recursive: true, mode: 0o700 });
const token = (await fs.readFile(path.join(root, 'internal-token'), 'utf8')).trim();
if (token.length < 32) throw new Error('invalid_internal_token');
const projects = new ProjectStore(root); await projects.init(); let projectMutation = false;
const bridge = new BridgeClient('http://127.0.0.1:17794', token);
const conversations = new ConversationStore(path.join(root,'conversations'));
const runs = new Map<string, AgentRun>(); const archived = new Map<string, any>(); let active: AgentRun | undefined; let admitting=false;
const historyFiles=await Promise.all((await fs.readdir(path.join(root,'runs'))).filter(f=>/^[a-f0-9-]{36}\.jsonl$/.test(f)).map(async file=>({file,modified:(await fs.stat(path.join(root,'runs',file))).mtimeMs})));
for (const {file} of historyFiles.sort((a,b)=>b.modified-a.modified).slice(0,200)) {
  const target = path.join(root, 'runs', file); if ((await fs.stat(target)).size > 1024 * 1024) continue;
  try {
    const events = (await fs.readFile(target,'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const meta = events.find(e => e.type === 'created')?.data; if (!meta) continue;
    const last = events.filter(e => e.type === 'state').at(-1)?.data.phase;
    archived.set(file.slice(0,-6), { ...meta, selected:events.find(e=>e.type==='model')?.data.selected || meta.selected, events, phase: ['completed','blocked','failed','cancelled'].includes(last) ? last : 'cancelled' });
  } catch { /* A partial trailing record is not silently treated as an active run. */ }
}
const health: AgentHealth = { ready: true, nativeHooks: false, hookMode: 'policy_bridge', explanation: 'Pi Hooks 由安全策略桥接审核并在本页记录。当前 AI Gateway 原生只支持 Codex／Claude Code，Pi 未登记到其 Agent Hooks 页。', projects: [{ id: 'demo', name: 'O6N 沙盒项目' }], models: [{ id: 'auto', label: 'Auto · 本地决策模型' }, { id: 'standard', label: 'Qwen3.5-9B · 后摩' }, { id: 'cloud', label: 'DeepSeek · 云端' }] };
const server = createServer(async (req, res) => {
  const json = (data: unknown, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  try {
    const auth = Buffer.from(req.headers.authorization ?? ''), expected = Buffer.from(`Bearer ${token}`);
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) return json({ code: 'unauthorized' }, 401);
    const url = new URL(req.url!, 'http://127.0.0.1');
    // The Python gateway derives this stable device principal; browsers cannot set it.
    const owner = String(req.headers['x-orion-owner'] || '');
    const legacy = String(req.headers['x-orion-legacy-owner'] || '');
    const getConversation = (id: string) => conversations.get(id, owner, legacy);
    const projectMatch = /^\/projects\/([a-z0-9_-]{1,40})(?:\/(files|read|write|mkdir|preview|import|update|export))?$/.exec(url.pathname);
    const conversationMatch = /^\/conversations\/([a-f0-9-]{32,36})(?:\/(complete))?$/.exec(url.pathname);
    if (req.method === 'GET' && conversationMatch && !conversationMatch[2]) {
      const item=getConversation(conversationMatch[1]); return json({...item,owner:undefined,legacyOwner:undefined,context:conversations.context(item)});
    }
    if (req.method === 'GET' && url.pathname === '/files') return json({files:await projects.workspace('demo').list()});
    if (req.method === 'GET' && url.pathname === '/projects') return json({ projects: await projects.list(owner) });
    if (req.method === 'GET' && url.pathname === '/conversations') return json({ conversations: conversations.list(owner, legacy) });
    if (req.method === 'GET' && projectMatch) {
      const [,id,action] = projectMatch;
      if (action === 'files') return json(await projects.tree(id,owner));
      if (action === 'export') return json(await projects.export(id,owner));
      if (!action) return json(projects.public(await projects.get(id,owner)));
    }
    if (req.method === 'GET' && url.pathname === '/health') return json({ ...health, projects: /^[a-f0-9]{64}$/.test(owner) ? (await projects.list(owner)).filter(p=>p.status!=='archived') : [], active: active?.id });
    const owned = (r:any) => { if(!r.conversationId)return true; try{return getConversation(r.conversationId).runIds.includes(r.id);}catch{return false;} };
    if (req.method === 'GET' && url.pathname === '/runs') return json({ runs: [...archived.values(),...[...runs.values()].map(r => r.view())].filter(owned).map(r => ({ ...r, events: [] })).sort((a,b) => b.created.localeCompare(a.created)) });
    const match = /^\/runs\/([a-f0-9-]{36})(?:\/(approve|cancel|events))?$/.exec(url.pathname);
    const run = match ? runs.get(match[1]) : undefined;
    if(match){ const target=run?.view() || archived.get(match[1]); if(target && !owned(target))return json({code:'conversation_denied'},403); }
    if (req.method === 'GET' && match?.[2] === 'events') {
      const view=run?.view() || archived.get(match[1]); if(!view)return json({code:'not_found'},404);
      res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});
      const send=(frame:unknown)=>{if(!res.destroyed){if(res.writableLength>1024*1024){res.destroy();return;}res.write(JSON.stringify(frame)+'\n');}};
      const terminal=(phase:string)=>['completed','blocked','failed','cancelled'].includes(phase);
      send({event:'snapshot',run:view});
      if(!run||terminal(view.phase)){res.end();return;}
      const heartbeat=setInterval(()=>send({event:'heartbeat'}),10000);
      const unsubscribe=run.onEvent(entry=>{
        const {events,...metadata}=run.view();send({event:'entry',entry,run:metadata});
        if(terminal(metadata.phase)){clearInterval(heartbeat);unsubscribe();res.end();}
      });
      res.on('close',()=>{clearInterval(heartbeat);unsubscribe();});return;
    }
    if (req.method === 'GET' && match && !match[2]) return run ? json(run.view()) : archived.has(match[1]) ? json(archived.get(match[1])) : json({code:'not_found'},404);
    if (req.method !== 'POST') return json({ code: 'not_found' }, 404);
    let raw = ''; for await (const chunk of req) { raw += chunk.toString(); if (Buffer.byteLength(raw) > (url.pathname.startsWith('/projects') ? 3*1024*1024 : 65536)) return json({ code: 'body_limit' }, 413); }
    const body = JSON.parse(raw || '{}');
    if (url.pathname === '/experiences/output') {
      if(!/^[a-f0-9]{64}$/.test(owner))return json({code:'unauthorized'},403);
      if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).length)return json({code:'invalid_request'},400);
      return json(outputProtectionSelfTest());
    }
    if (url.pathname === '/projects' || projectMatch) {
      if (projectMutation || admitting) return json({code:'project_busy'},409);
      const id = projectMatch?.[1], action = projectMatch?.[2];
      if (id) await projects.get(id,owner);
      if (action === 'read') return json(await projects.file(id!,owner,body.path));
      if (id && active?.project === id) return json({code:'project_busy'},409);
      projectMutation = true;
      try {
        if (!id) return json(await projects.create(body,owner),201);
        if (action === 'update') return json(await projects.update(id,owner,body));
        if (action === 'write') return json(await projects.write(id,owner,body));
        if (action === 'mkdir') return json(await projects.mkdir(id,owner,body.path));
        if (action === 'preview') return json(await projects.preview(id,owner,body.files));
        if (action === 'import') return json(await projects.commit(id,owner,body.id));
        return json({code:'not_found'},404);
      } finally { projectMutation = false; }
    }
    if (url.pathname === '/conversations') {
      const id=conversationId(body.id);
      try { getConversation(id); } catch (e:any) { if(e.code!=='ENOENT')throw e; }
      const item=conversations.ensure(id,owner,legacy);
      if(body.project){ await projects.get(body.project,owner,true); conversations.bindProject(item,body.project); }
      if(body.title!==undefined){if(typeof body.title!=='string'||!body.title.trim()||body.title.length>80)throw new Error('invalid_title');(item as any).title=body.title.trim();conversations.save(item);}
      return json({...item,owner:undefined,legacyOwner:undefined});
    }
    if (conversationMatch?.[2] === 'complete') {
      // Only the gateway can attest a completed plain-chat turn, never the browser proxy.
      if(req.headers['x-orion-attested']!=='chat-completed')return json({code:'attestation_required'},403);
      const turn=body as CompletedTurn; if(turn.engine!=='chat'||!['agent','ask'].includes(turn.snapshot?.mode)||turn.snapshot?.files?.length||turn.snapshot?.access&&turn.snapshot.access!=='read'||turn.snapshot?.execution&&turn.snapshot.execution!=='answer')throw new Error('invalid_turn');
      const item=conversations.ensure(conversationMatch[1],owner,legacy);
      if(turn.snapshot.project){await projects.get(turn.snapshot.project,owner,true);if(item.project!==turn.snapshot.project)throw new Error('invalid_turn');}
      conversations.complete(conversationMatch[1],owner,turn,legacy); return json({ok:true});
    }
    if (url.pathname === '/runs') {
      if (active || admitting || projectMutation) return json({ code: 'agent_busy' }, 409);
      admitting=true;
      try {
      if (runs.size >= 200) return json({ code: 'run_limit_restart_required' }, 429);
      const p = parseAgentRequest(body); const project = await projects.get(p.project,owner,true); const workspace = projects.workspace(p.project,owner);
      const cid=body.conversationId ? conversationId(body.conversationId) : undefined, tid=body.turnId ? conversationId(body.turnId) : undefined;
      if(Boolean(cid)!==Boolean(tid))throw new Error('invalid_turn');
      if(cid){try{getConversation(cid);}catch(e:any){if(e.code!=='ENOENT')throw e;}}
      const item=cid ? conversations.ensure(cid,owner,legacy) : undefined;
      if(item && (item.turns.some(t=>t.id===tid)||[...runs.values(),...archived.values()].some(r=>r.conversationId===cid&&r.turnId===tid)))throw new Error('duplicate_turn');
      if(item)conversations.bindProject(item,p.project);
      const files=body.files ?? []; if(!Array.isArray(files)||files.length>5||files.some((f:unknown)=>typeof f!=='string'||f.length>240))throw new Error('invalid_files');
      const allowed=await workspace.list(); if(files.some((f:string)=>!allowed.includes(f)))return json({code:'file_denied'},403);
      const next = new AgentRun(p.project, p.model, bridge, workspace, root, token,p.access); next.setPrompt(p.prompt);
      next.setRouting(p.scope,owner,p.decisionEngine);
      next.setOutput(p.output); next.setInstructions(project.description || '');
      if(item && tid) { next.setContext(item.id,tid,contextMessages(item.turns,Math.max(0,Math.min(3000,7000-p.prompt.length-(files.length?2000:0)))),files); item.runIds.push(next.id); conversations.save(item); }
      next.emit('created',{ id:next.id,project:p.project,model:p.model,scope:p.scope,decisionEngine:p.decisionEngine,output:p.output,access:p.access,selected:'',created:next.created,conversationId:cid,turnId:tid,files }); runs.set(next.id, next); active = next;
      void next.start().then(()=>{
        if(item&&tid&&next.phase==='completed') { const answer=next.events.filter(e=>e.type==='answer').map(e=>String(e.data.text)).join('\n'); if(answer)conversations.complete(item.id,owner,{id:tid,engine:'pi',prompt:p.prompt,answer,created:next.created,runId:next.id,snapshot:{mode:'agent',execution:'tools',access:p.access,model:p.model,scope:p.scope,decisionEngine:p.decisionEngine,project:p.project,files}},legacy); }
      }).catch(() => { next.emit('context_persistence_error',{code:'context_not_saved'}); }).finally(() => { if (active === next) active = undefined; });
      return json(next.view(), 202);
      } finally {admitting=false;}
    }
    if (!run) return json({ code: 'not_found' }, 404);
    if(run.conversationId && (body.conversationId!==run.conversationId || body.turnId!==run.turnId))return json({code:'turn_mismatch'},409);
    if (match![2] === 'cancel') { run.cancel(); return json({ ok: true }); }
    if (match![2] === 'approve' && typeof body.id === 'string' && typeof body.digest === 'string' && typeof body.allowed === 'boolean') { run.approve(body.id, body.digest, body.allowed); return json({ ok: true }); }
    return json({ code: 'invalid_request' }, 400);
  } catch (error) {
    const allowed = new Set(['cloud_scope_required','invalid_scope','invalid_decision_engine','project_not_found','project_denied','project_archived','invalid_project_name','project_description_limit','project_changed','project_limit','path_denied','linked_path_denied','path_exists','path_depth','file_limit','text_file_limit','sensitive_tool_content','stale_approval','project_storage_limit','import_limit','import_empty','import_expired','stale_import','legacy_import_requires_new_project','project_changed_new_conversation_required','conversation_denied']);
    const code=error instanceof Error&&allowed.has(error.message)?error.message:'invalid_request';
    return json({code}, ['project_denied','conversation_denied'].includes(code)?403:code==='project_not_found'?404:['stale_approval','project_changed','project_archived','stale_import','project_changed_new_conversation_required'].includes(code)?409:400);
  }
});
const listenPort=process.env.ORION_AGENT_PORT===undefined?17795:Number(process.env.ORION_AGENT_PORT);
if(!Number.isInteger(listenPort)||listenPort<0||listenPort>65535)throw new Error('invalid_loopback_port');
server.listen(listenPort, '127.0.0.1', () => console.log('Orion Pi Agent ready on loopback '+(server.address() as {port:number}).port));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { active?.cancel(); server.close(); setTimeout(() => process.exit(0), 2000).unref(); });
