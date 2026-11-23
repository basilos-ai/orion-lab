import type { AgentRunView, ChatSession, ConversationView } from './types';
export const workspaceKey = 'orion-workspace-sessions-v1';
export const legacyKey = 'o6n-controlled-sessions-v3';
export function diffLines(before:string,after:string) {
  const a=before===''?[]:before.split('\n'),b=after===''?[]:after.split('\n');let first=0,last=0;
  while(first<a.length&&first<b.length&&a[first]===b[first])first++;
  while(last<a.length-first&&last<b.length-first&&a[a.length-1-last]===b[b.length-1-last])last++;
  return [...a.slice(0,first).map((text,i)=>({kind:'same',old:i+1,next:i+1,text})),...a.slice(first,a.length-last).map((text,i)=>({kind:'remove',old:first+i+1,next:0,text})),...b.slice(first,b.length-last).map((text,i)=>({kind:'add',old:0,next:first+i+1,text})),...a.slice(a.length-last).map((text,i)=>({kind:'same',old:a.length-last+i+1,next:b.length-last+i+1,text}))];
}
/** Idempotent, read-only legacy migration. Keep the old key intact for rollback. */
export function migrateSessions(current: ChatSession[], legacy: ChatSession[]) {
  const items=new Map<string,ChatSession>();
  for(const item of [...(Array.isArray(current)?current:[]),...(Array.isArray(legacy)?legacy:[])]) if(item?.id&&Array.isArray(item.messages)&&!items.has(item.id))items.set(item.id,item);
  return [...items.values()];
}
/** Merge server-owned completed turns with pending/rejected run rows imported from metadata. */
export function restoreConversation(sessions:ChatSession[],item:ConversationView,runs:Record<string,AgentRunView>):ChatSession[] {
  const existing=sessions.find(s=>s.id===item.id);
  // A browser with full chat history is authoritative for its local IDs, names and drafts.
  if(existing?.messages.some(m=>!m.runId&&!m.id.endsWith('-user')))return sessions;
  const times=new Map<string,string>();
  const messages:ChatSession['messages']=item.turns.flatMap(t=>{
    const user=t.runId?t.runId+'-user':t.id,reply=t.runId?t.runId+'-reply':t.id+'-reply';times.set(user,t.created);times.set(reply,t.created);
    return [{id:user,role:'user' as const,content:t.prompt,snapshot:t.snapshot},{id:reply,role:'assistant' as const,content:t.answer,snapshot:t.snapshot,runId:t.runId,meta:t.feedback}];
  });
  const ids=new Set(messages.map(m=>m.id));
  for(const message of existing?.messages||[])if(!ids.has(message.id)) {
    const runId=message.runId||message.id.replace(/-user$/,'');times.set(message.id,runs[runId]?.created||item.created);messages.push(message);
  }
  messages.sort((a,b)=>(Date.parse(times.get(a.id)||'')||0)-(Date.parse(times.get(b.id)||'')||0));
  const title=existing&&existing.title!=='新对话'&&!existing.title.startsWith('Pi 历史任务')?existing.title:item.turns[0]?.prompt.slice(0,32)||existing?.title||'恢复的对话';
  const session:ChatSession={id:item.id,title,boundProject:item.project,project:existing?.project===undefined?item.project:existing.project,messages,draftOnly:existing?.draftOnly===true&&!item.turns.length&&!item.runIds.length};
  return existing?sessions.map(s=>s.id===item.id?session:s):[session,...sessions];
}
export function attachRun(sessions: ChatSession[], run: AgentRunView): ChatSession[] {
  const id=run.conversationId || run.id;
  const existing=sessions.find(s=>s.id===id);
  const prompt=run.events.find(e=>e.type==='prompt')?.data.text;
  const done=['completed','blocked','failed','cancelled'].includes(run.phase);
  const failed=done&&run.phase!=='completed';
  const snapshot={mode:'agent' as const,execution:'tools' as const,access:run.access||'read' as const,model:run.model,scope:run.scope||(run.model==='cloud'?'hybrid' as const:'local' as const),decisionEngine:run.decisionEngine||'laya',project:run.project,files:run.files||[]};
  const pair:ChatSession['messages']=[{id:run.id+'-user',role:'user',content:failed?'[本轮未进入后续上下文]':String(prompt||'Pi 任务'),excluded:failed,snapshot},{id:run.id+'-reply',role:'assistant',content:run.phase==='completed'?run.events.filter(e=>e.type==='answer').map(e=>String(e.data.text)).join('\n'):'',excluded:failed,runId:run.id,snapshot}];
  // The original optimistic user message has the same stable IDs; polling replaces it.
  const item:ChatSession={...(existing||{id,title:prompt?String(prompt).slice(0,32):'Pi 历史任务'+(run.created?' · '+new Date(run.created).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):''),messages:[]}),boundProject:existing?.boundProject||run.project,project:existing?.project===undefined?run.project:existing.project,messages:[...(existing?.messages||[]).filter(m=>!pair.some(p=>p.id===m.id)),...pair]};
  if(prompt&&(!existing||existing.title==='新对话'||existing.title.startsWith('Pi 历史任务')))item.title=String(prompt).slice(0,32);
  // Preserve chronological position when polling an older run in a mixed conversation.
  if(existing?.messages.some(m=>m.id===pair[0].id))item.messages=existing.messages.map(m=>pair.find(p=>p.id===m.id)||m);
  return existing?sessions.map(s=>s.id===id?item:s):[...sessions,item];
}
