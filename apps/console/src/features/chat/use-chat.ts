import { t, localizedLabels, errorText, uiText } from '@/lib/i18n';
import { useEffect, useRef, useState } from 'react';
import {decisionEngineNames as rawDecisionEngineNames, planTurn, type DecisionEngine} from '@orion/contracts';
import { config, storageRead, storageWrite } from '@/lib/config';
import { gatewayDisplayText } from '@/lib/gateway-brand';
import { chatPreferencesKey, loadChatPreferences, hasUnsentDrafts } from '@/lib/chat-preferences';
import { consumeEvents, excludedTurn, modelHistory, safeSessionSnapshot, textContent, requestError, StreamRequestError } from '@/lib/stream';
import type { ChatMessage, ChatSession, Health, Mode, Scope, StreamEvent, RequestError, DocumentAttachment } from '@/lib/types';
import type { AgentHealth, AgentRunView } from '@/lib/types';
import { migrateSessions, attachRun, restoreConversation, workspaceKey, legacyKey } from '@/lib/workspace';
import type { ProjectSummary, ProjectFiles, ImportPreview, AgentStreamFrame } from '@orion/contracts';

export const names: Record<Mode, string> = { auto: 'Auto', small: 'Qwen3.5-4B', tiny:'Qwen3.5-2B', vision:'MiniCPM-V 4.7 1B', cpu:'MiniCPM5-2B', standard: 'Qwen3.5-9B', large: 'Qwen3.8-27B-MTP', cloud: 'DeepSeek-V4.1-Flash-1017' };
export const stageNames: Record<string, string> = { get document_reviewing() { return t("正在审核文档文字"); }, get routing() { return t("本地自动选模"); }, get model_loading() { return t("正在准备回答模型"); }, get image_reviewing() { return t("正在本地检查图片"); }, get decision_loading() { return t("正在准备本地决策模型"); }, get model_selected() { return t("手动指定模型"); }, get input_checking() { return t("AI Gateway 输入审核中"); }, get input_matched() { return t("策略命中，等待网关确认"); }, get input_passed() { return t("输入审核通过"); }, get input_blocked() { return t("输入被阻断"); }, get review_unavailable() { return t("审核未完成"); }, get generating() { return t("模型回答中"); }, get completed() { return t("回答完成"); }, get cancelled() { return t("已取消"); } };
const storageKey = workspaceKey;
const uid = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
const newSession = (): ChatSession => ({ id: uid(), title: '新对话', messages: [], draftOnly: true });

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json(); if (!response.ok) throw new Error(errorText(gatewayDisplayText(typeof result.error === 'string' ? result.error : t("请求失败 {0}", [response.status])), result.code)); return result;
}
export function documentErrorText(code:string){return ({document_type:t("仅支持内容匹配的 PDF、DOCX 文件。"),document_size_limit:t("单份文档最多10 MiB。"),document_page_limit:t("PDF 最多20页。"),document_no_text:t("未提取到文字，请使用可复制文字的 PDF 或 DOCX；当前不识别扫描件。"),document_parse_failed:t("文档提取失败，可能损坏或结构不受支持，请另存后重试。"),document_encrypted:t("暂不支持加密文档，请先解除加密。"),document_expanded_limit:t("文档解压后过大，请缩小文档。"),document_embedded_object:t("文档含宏或嵌入文件，请移除后重试。"),document_xml_denied:t("文档包含不支持的 XML 结构。"),document_text_limit:t("提取文字超过10万字符，请拆分文档。"),document_upload_limit:t("待处理文档过多，请稍后重试。"),document_busy:t("其他文档正在提取，请稍后重试。"),session_required:t("设备会话已失效，请刷新后重新提交。")} as Record<string,string>)[code]||t("文档未能提交，请稍后重试。");}
export function useChat() {
  const [sessions, setSessions] = useState<ChatSession[]>(() => { const saved = migrateSessions(storageRead<ChatSession[]>(storageKey, []),storageRead<ChatSession[]>(legacyKey, [])); return saved.length?saved:[newSession()]; });
  const sessionsRef = useRef(sessions), pendingIds = useRef(new Set<string>());
  const [currentId, setCurrentId] = useState(() => {const id=new URL(location.href).searchParams.get('conversation');return id&&/^[a-f0-9-]{32,36}$/.test(id)?id:sessions[0].id;});
  const [initialPreferences] = useState(() => loadChatPreferences());
  const [documents, setDocuments] = useState<File[]>([]);
  const [text, setText] = useState(''), [images, setImages] = useState<string[]>([]), [mode, setMode] = useState<Mode>(initialPreferences.mode), [scope, setScope] = useState<Scope>(initialPreferences.scope);
  const [decisionEngine,setDecisionEngine]=useState<DecisionEngine>(()=>{const saved=storageRead<string>('orion-decision-engine-v1','qwen35-2b-houmo');return Object.hasOwn(decisionEngineNames,saved)?saved as DecisionEngine:'qwen35-2b-houmo';});
  useEffect(()=>{storageWrite('orion-decision-engine-v1',decisionEngine);},[decisionEngine]);
  const [health, setHealth] = useState<Health | null>(null), [connectionError, setConnectionError] = useState(false), [authorized, setAuthorized] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [liveStatus, setLiveStatus] = useState('');
  useEffect(() => {
    if (!storageWrite(chatPreferencesKey, { mode, scope })) setNotice(t("浏览器存储不可用，回答模型和调用范围无法在刷新后保留。"));
  }, [mode, scope]);
  const [sessionStatus, setSessionStatus] = useState<'checking' | 'authorized' | 'denied' | 'unavailable'>('checking');
  const pendingDrafts = useRef(new Map<string, { text: string; images: string[]; files:string[]; documents:File[]; mode:Mode; scope:Scope; decisionEngine:DecisionEngine }>()), rejectedDrafts = useRef(new Map<string, { text: string; images: string[]; documents?:File[] }>());
  const controller = useRef<AbortController | null>(null), mounted = useRef(true), busyRef = useRef(false), healthSequence = useRef(0);
  const current = sessions.find(item => item.id === currentId) || sessions[0];
  const workMode='agent' as const;
  const [files,setFiles]=useState<string[]>([]),[availableFiles,setAvailableFiles]=useState<string[]>([]);
  const [projects,setProjects]=useState<ProjectSummary[]>([]),[projectDialog,setProjectDialog]=useState<'create'|'manage'|'files'|null>(null),[projectError,setProjectError]=useState('');
  const [agentHealth,setAgentHealth]=useState<AgentHealth|null>(null),[runs,setRuns]=useState<Record<string,AgentRunView>>({}),[activeConversation,setActiveConversation]=useState<string|null>(null),[agentPending,setAgentPending]=useState(false),[cancelPending,setCancelPending]=useState(false);
  const agentSubmission=useRef(false),processingAgent=useRef<string|null>(null),runsRef=useRef(runs);
  const agentBusy=Boolean(agentHealth?.active||agentPending),allBusy=busy||agentBusy||cancelPending;
  const currentIdRef=useRef(currentId);currentIdRef.current=currentId;
  const hasImages=Boolean(images.length||current.messages.some(m=>!m.excluded&&Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url')));
  const hasDocuments=Boolean(documents.length||current.messages.some(m=>!m.excluded&&(m.documents?.length||textContent(m.content).includes('[[ORION_DOCUMENT:'))));
  const turnPlan=hasDocuments?{execution:'answer' as const,access:'read' as const,needsProject:false,needsToolModel:false,imageTools:false}:planTurn({prompt:text,project:current.project,files,model:mode,images:hasImages});
  const toolMode=turnPlan.execution==='tools';
  useEffect(()=>{if(!authorized||!current.project||config.demo){setAvailableFiles([]);return;}let alive=true;void agentApi<{files:string[]}>('/projects/'+current.project+'/files').then(r=>{if(alive)setAvailableFiles(r.files);}).catch(()=>{});return()=>{alive=false;};},[authorized,current.project,projectDialog]);
  async function agentApi<T>(route:string,body?:unknown):Promise<T>{ const response=await fetch('/api/agent'+route,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(({device_busy:t("另一个任务正在处理，请稍后重试。"),agent_busy:t("另一个任务正在处理，请稍后重试。"),model_not_ready:t("所选模型尚未就绪，请稍后重试。"),cloud_scope_required:t("仅本地模式不调用云端，请先切换为允许云端。"),invalid_scope:t("调用范围不合法，请重新选择。"),invalid_decision_engine:t("决策模型不合法，请重新选择。"),context_budget:t("对话内容过长，请减少文件或新建对话。"),file_denied:t("该文件未获得访问授权。"),project_busy:t("项目有任务正在执行，请结束任务后再修改文件或归档。"),project_archived:t("项目已归档，请恢复后继续。"),project_denied:t("无权访问此项目。"),project_changed:t("项目信息已更新，请重新打开后保存。"),project_changed_new_conversation_required:t("此会话已绑定项目，请在目标项目中新建会话。"),invalid_project_name:t("请输入不超过60字的项目名称。"),project_description_limit:t("项目说明不能超过1500字。"),path_denied:t("路径不合法，或属于隐藏、受保护目录。"),path_exists:t("路径已存在，请使用其他名称。"),path_depth:t("目录层级超出限制。"),file_limit:t("文件过大，单个文本文件最多32 KiB。"),sensitive_tool_content:t("内容包含凭据或敏感信息，请移除后再保存。"),stale_approval:t("文件已被其他操作修改，请重新打开后编辑。"),stale_import:t("项目文件已变动，请重新生成导入预览。"),project_storage_limit:t("项目超出文件数或容量限制，请缩小导入范围。"),import_expired:t("预览已过期或服务已重启，请重新预览。"),import_empty:t("没有可导入的文本文件。"),legacy_import_requires_new_project:t("示例项目保留原始文件，请创建新项目后导入。"),project_limit:t("已达到项目数量上限。")} as Record<string,string>)[result.code]||t("请求未能提交，请稍后重试。"));return result; }
  async function refreshProjects(){try{const result=await agentApi<{projects:ProjectSummary[]}>('/projects');setProjects(result.projects);setProjectError('');return result.projects;}catch(e){setProjectError((e as Error).message);throw e;}}
  async function projectRequest<T>(id:string,action:string,body?:unknown):Promise<T>{const result=await agentApi<T>('/projects/'+id+'/'+action,body);if(body!==undefined&&action!=='read')await refreshProjects();return result;}
  async function createProject(body:{id:string;name:string;description:string}){const project=await agentApi<ProjectSummary>('/projects',body);await refreshProjects();await refreshAgent();createSession(project.id);return project;}
  async function updateProject(project:ProjectSummary,body:Record<string,unknown>){const result=await projectRequest<ProjectSummary>(project.id,'update',{...body,revision:(project as ProjectSummary&{revision?:string}).revision});await refreshAgent();return result;}
  useEffect(()=>{if(!authorized||config.demo)return;void refreshProjects().catch(()=>{});void agentApi<{conversations:{id:string;project:string|null;title:string}[]}>('/conversations').then(result=>{commit(items=>[...items,...result.conversations.filter(c=>!items.some(s=>s.id===c.id)).map(c=>({...c,boundProject:c.project,messages:[]}))],true);}).catch(()=>{});},[authorized]);
  function acceptRun(run:AgentRunView,persist=true){
    const prior=runsRef.current[run.id],oldSeq=prior?.events.at(-1)?.seq||0,newSeq=run.events.at(-1)?.seq||0;
    if(prior&&newSeq<oldSeq||prior&&newSeq===oldSeq&&prior.phase===run.phase)return;
    runsRef.current={...runsRef.current,[run.id]:run};setRuns(runsRef.current);commit(items=>attachRun(items,run),persist);
  }
  async function refreshAgent(){const h=await agentApi<AgentHealth>('/health');if(!mounted.current)return;setAgentHealth(h);if(h.active){processingAgent.current=h.active;const r=await agentApi<AgentRunView>('/runs/'+h.active);acceptRun(r);setActiveConversation(r.conversationId||r.id);}else if(processingAgent.current){const r=await agentApi<AgentRunView>('/runs/'+processingAgent.current);acceptRun(r);processingAgent.current=null;setCancelPending(false);setActiveConversation(null);}}
  useEffect(()=>{if(!authorized||config.demo)return;let alive=true;void(async()=>{try{const list=await agentApi<{runs:AgentRunView[]}>('/runs');if(!alive)return;for(const r of list.runs){if(!runsRef.current[r.id]?.events.length)runsRef.current[r.id]=r;commit(items=>items.some(s=>s.messages.some(m=>m.runId===r.id))?items:attachRun(items,r),true);}setRuns({...runsRef.current});await refreshAgent();}catch{setNotice(t("Pi 连接暂不可用；普通问答仍可使用。"));}})();const timer=setInterval(()=>void refreshAgent().catch(()=>{}),1200);return()=>{alive=false;clearInterval(timer);};},[authorized]);
  useEffect(()=>{
    const id=agentHealth?.active;if(!authorized||config.demo||!id)return;
    const abort=new AbortController();let attempts=0;
    void(async()=>{
      while(!abort.signal.aborted&&attempts<3){
        try{
          const response=await fetch('/api/agent/runs/'+id+'/events',{signal:abort.signal,cache:'no-store'});
          await consumeEvents(response,value=>{
            const frame=value as unknown as AgentStreamFrame;
            if(frame.event==='snapshot')acceptRun(frame.run,['completed','blocked','failed','cancelled'].includes(frame.run.phase));
            if(frame.event==='entry'){
              const old=runsRef.current[id];if(!old||frame.entry.seq<=(old.events.at(-1)?.seq||0))return;
              const events=[...old.events,frame.entry];
              acceptRun({...frame.run,events},['state','approval','approval_resolved','error'].includes(frame.entry.type));
            }
          });
          if(['completed','blocked','failed','cancelled'].includes(runsRef.current[id]?.phase||''))break;
        }catch{if(abort.signal.aborted)return;}
        attempts++;await new Promise(resolve=>setTimeout(resolve,500));
      }
      if(!abort.signal.aborted&&attempts>=3&&!['completed','blocked','failed','cancelled'].includes(runsRef.current[id]?.phase||''))setNotice(t("连接不稳定，正在恢复回答。"));
    })();
    return()=>abort.abort();
  },[authorized,agentHealth?.active]);
  const currentRunIds=current.messages.flatMap(m=>m.runId?[m.runId]:[]).join(',');
  useEffect(()=>{if(!authorized)return;const ids=currentRunIds?currentRunIds.split(','):[];void Promise.all(ids.map(async id=>{try{acceptRun(await agentApi<AgentRunView>('/runs/'+id));}catch{/* Keep the visible saved history while offline. */}}));},[currentId,authorized,currentRunIds]);
  useEffect(()=>{
    if(!authorized||config.demo)return;
    const known=sessionsRef.current.find(s=>s.id===currentId);
    if(known?.messages.some(m=>!m.runId&&!m.id.endsWith('-user')))return;
    void agentApi<import('@/lib/types').ConversationView>('/conversations/'+currentId).then(item=>{commit(items=>restoreConversation(items,item,runsRef.current),true);setNotice(value=>uiText(value)===t('此会话尚未保存在服务器；请选择现有对话。')?'':value);}).catch(()=>{if(currentIdRef.current===currentId&&!sessionsRef.current.some(s=>s.id===currentId))setNotice(t("此会话尚未保存在服务器；请选择现有对话。"));});
  },[currentId,authorized,currentRunIds]);
  useEffect(()=>{if(cancelPending&&!busy&&!agentBusy&&health?.busy===false){setCancelPending(false);setActiveConversation(null);}},[cancelPending,busy,agentBusy,health?.busy]);
  useEffect(()=>{if(!cancelPending)return;const timer=setInterval(()=>void refreshHealth(),1000);return()=>clearInterval(timer);},[cancelPending]);
  useEffect(()=>{const url=new URL(location.href);url.searchParams.set('conversation',currentId);url.hash='chat';history.replaceState(null,'',url);},[currentId]);
  function commit(update: (items: ChatSession[]) => ChatSession[], persist = false) {
    const next = update(sessionsRef.current); sessionsRef.current = next; setSessions(next);
    if (persist && !storageWrite(storageKey, safeSessionSnapshot(next, pendingIds.current))) setNotice(t("浏览器存储不可用，本次对话只暂存在内存。"));
  }
  async function refreshHealth() {
    if (config.demo) { setAuthorized(true); setSessionStatus('authorized'); return; }
    const sequence = ++healthSequence.current;
    try { const response = await fetch('/api/health', { cache: 'no-store' }); if (!response.ok) throw new Error(); const result: Health = await response.json(); if (mounted.current && sequence === healthSequence.current) { setHealth(result); setConnectionError(false); } }
    catch { if (mounted.current && sequence === healthSequence.current) setConnectionError(true); }
  }
  async function refreshSession(signal?: AbortSignal) {
    if (config.demo) { setAuthorized(true); setSessionStatus('authorized'); return; }
    if (mounted.current) setSessionStatus('checking');
    try {
      const response = await fetch('/api/session', { signal }), value = await response.json();
      if (!mounted.current || signal?.aborted) return;
      if ((!response.ok && ![401, 403].includes(response.status)) || (response.ok && typeof value.authorized !== 'boolean')) throw new Error('Device session unavailable');
      const allowed = response.ok && value.authorized === true;
      setAuthorized(allowed);
      setSessionStatus(allowed ? 'authorized' : 'denied');
    } catch {
      if (mounted.current && !signal?.aborted) { setAuthorized(false); setSessionStatus('unavailable'); }
    }
  }
  useEffect(() => {
    mounted.current = true; const abort = new AbortController();
    void refreshSession(abort.signal);
    void refreshHealth(); const interval = setInterval(refreshHealth, 10000);
    return () => { mounted.current = false; abort.abort(); controller.current?.abort(); clearInterval(interval); };
  }, []);
  useEffect(() => { const protect = (event: BeforeUnloadEvent) => { if (allBusy || hasUnsentDrafts(current.id, { text, images, files, documents }, pendingDrafts.current)) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', protect); return () => window.removeEventListener('beforeunload', protect); }, [allBusy, current.id, text, images, files, documents]);
  function chooseSession(id: string) {
    if(id===currentId||!sessionsRef.current.some(item=>item.id===id))return;
    pendingDrafts.current.set(currentId, { text, images, files, documents, mode, scope, decisionEngine }); setCurrentId(id); const draft = pendingDrafts.current.get(id); setText(draft?.text || ''); setImages(draft?.images || []); setDocuments(draft?.documents || []); setFiles(draft?.files||[]);setMode(draft?.mode||mode);setScope(draft?.scope||scope);setDecisionEngine(draft?.decisionEngine||decisionEngine);setNotice('');
  }
  function createSession(project:string|null=null) {
    const available=sessionsRef.current.filter(item=>item.draftOnly===true&&!item.messages.length&&item.title==='新对话'&&(item.project||null)===project&&(item.boundProject||null)===project&&!pendingIds.current.has(item.id)&&item.id!==activeConversation);
    const empty=available.find(item=>item.id===currentId)||available.find(item=>{const draft=pendingDrafts.current.get(item.id);return draft&&(draft.text.trim()||draft.images.length||draft.files.length||draft.documents?.length);})||available.find(item=>pendingDrafts.current.has(item.id))||available[0];
    if(empty){
      if(empty.id!==currentId){const saved=pendingDrafts.current.has(empty.id);chooseSession(empty.id);if(!saved){setFiles([]);setMode('auto');if(project)setScope('local');}}
      return;
    }
    pendingDrafts.current.set(currentId, { text, images, files, documents, mode, scope, decisionEngine }); const item = {...newSession(),project,boundProject:project}; commit(items => [item, ...items], true); setCurrentId(item.id); setFiles([]); setMode('auto'); setText(''); setImages([]); setDocuments([]); setNotice('');
    if(project){setScope('local');setMode('auto');if(!config.demo)void agentApi('/conversations',{id:item.id,project}).catch(e=>setNotice(gatewayDisplayText((e as Error).message)));}
  }
  function openProject(id:string){const existing=sessionsRef.current.find(s=>s.project===id);if(existing)chooseSession(existing.id);else createSession(id);}
  function rename(title: string, id=currentId) { const next=title.trim()||'新对话';commit(items => items.map(item => item.id === id ? { ...item, title: next } : item), true);if(authorized&&!config.demo)void agentApi('/conversations',{id,title:next}).catch(()=>setNotice(t("名称已保存在浏览器，服务器同步失败；可重试重命名。"))); }
  async function pollMonitor(sessionId: string, messageId: string, gatewayId: string) {
    for (let attempt = 0; attempt < 8 && mounted.current; attempt++) {
      try { const response = await fetch(`/api/record?id=${encodeURIComponent(gatewayId)}`); if (response.ok) { const result = await response.json(), monitor = result.events?.find((event: { kind: string }) => event.kind === 'monitor'); if (monitor) { commit(items => items.map(item => item.id !== sessionId ? item : { ...item, messages: item.messages.map(message => message.id !== messageId ? message : { ...message, meta: { ...message.meta, monitor } }) }), true); return; } } } catch { /* Monitor is asynchronous and never changes the answer verdict. */ }
      await new Promise(resolve => setTimeout(resolve, 700));
    }
  }
  async function send() {
    if (busyRef.current || agentSubmission.current || agentBusy || cancelPending || !authorized || current.id!==currentId) return;
    const input = text.trim() || (documents.length?t("请总结这些文档的文字内容。"):''), sentImages = [...images], sentDocumentFiles=[...documents]; if (!input && !images.length) return;
    if(hasDocuments&&(images.length||current.messages.some(m=>!m.excluded&&Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url')))){setNotice(t("文档文字问答与图片问答请分开会话发送。"));return;}
    if(documents.length&&files.length){setNotice(t("文档问答本轮不执行项目工具，请先移除已选的项目文件。"));return;}
    if (config.demo) { setNotice(t("当前为演示预览，未发送内容或调用模型。")); return; }
    if(turnPlan.needsProject){setNotice(t("访问项目文件需要先选择项目，草稿已保留。"));setProjectDialog('manage');return;}
    if(turnPlan.needsToolModel){setNotice(t("当前模型仅支持对话。请切换 Auto 或 9B 后继续，草稿已保留。"));return;}
    if(turnPlan.imageTools){setNotice(t("请先完成图片问答，再移除图片上下文或新建项目会话执行文件任务。"));return;}
    if(mode==='cloud'&&scope!=='hybrid'){setNotice(t("仅本地模式不调用云端，请先切换为允许云端。"));return;}
    if(toolMode){
      if(!current.project){setNotice(t("Agent 需要先通过“添加上下文”选择授权项目。"));return;}
      if(!['auto','standard','cloud'].includes(mode)){setNotice(t("工具任务支持 Auto、本地9B、DeepSeek；请选择兼容模型。"));return;}
      if(mode==='cloud'&&scope!=='hybrid'){setNotice(t("仅本地模式不调用云端，请先切换为允许云端。"));return;}
      if(images.length){setNotice(t("图片审核尚未开放。"));return;}
      agentSubmission.current=true;setAgentPending(true);setNotice('');
       try{await agentApi('/conversations',{id:current.id});const run=await agentApi<AgentRunView>('/runs',{project:current.project,model:mode,scope,decision_engine:decisionEngine,access:turnPlan.access,prompt:input,conversationId:current.id,turnId:uid(),files});processingAgent.current=run.id;rejectedDrafts.current.set(run.id,{text:input,images:[]});setActiveConversation(current.id);acceptRun(run);pendingDrafts.current.delete(current.id);if(currentIdRef.current===current.id){setText('');setFiles([]);}await refreshAgent();}
      catch(e){setNotice(gatewayDisplayText((e as Error).message));}finally{agentSubmission.current=false;setAgentPending(false);}return;
    }
    const sessionId = current.id, hasImages = images.length || current.messages.some(message => !message.excluded && Array.isArray(message.content) && message.content.some(part => part.type === 'image_url'));
    if (hasImages && !['auto','standard','vision'].includes(mode)) { setNotice(t("含图对话请选择 MiniCPM-V、9B 或 Auto。图片只在本机处理。")); return; }
    const snapshot={mode:'agent' as const,execution:'answer' as const,access:'read' as const,model:mode,scope,decisionEngine,project:current.project||null,files:[]};
    let sentDocuments:DocumentAttachment[]=[];
    if(sentDocumentFiles.length){
      busyRef.current=true;setBusy(true);setActiveConversation(sessionId);setLiveStatus(t("正在提取文档文字"));controller.current=new AbortController();
      try{
        for(const file of sentDocumentFiles){
          const query=new URLSearchParams({name:file.name,conversation:sessionId});
          const response=await fetch('/api/documents?'+query,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file,signal:controller.current.signal});
          const item=await response.json();if(!response.ok)throw new Error(documentErrorText(item.code));sentDocuments.push(item);
        }
      }catch(error){setNotice((error as Error).name==='AbortError'?t("已停止文档提交，草稿保留。"):(error as Error).message);return;}
      finally{busyRef.current=false;setBusy(false);setCancelPending(false);controller.current=null;setActiveConversation(null);}
    }
    const user: ChatMessage = { id: uid(), role: 'user', snapshot, documents:sentDocuments.length?sentDocuments:undefined, content: images.length ? [{ type: 'text', text: input || t("请查看这张图片。") }, ...images.map(url => ({ type: 'image_url' as const, image_url: { url } }))] : input };
    let reply: ChatMessage = { id: uid(), role: 'assistant', content: '', meta: { mode, scope, decision_engine:decisionEngine, stages: [] } };
    const payload = modelHistory([...current.messages, user]); pendingIds.current = new Set([user.id, reply.id]);
    commit(items => items.map(item => item.id === sessionId ? { ...item, messages: [...item.messages, user, reply] } : item));
    if(currentIdRef.current===sessionId){setText(''); setImages([]); setDocuments([]);} pendingDrafts.current.delete(sessionId); busyRef.current = true; setBusy(true); setNotice(''); setLiveStatus(t("请求已提交"));
    setActiveConversation(sessionId); controller.current = new AbortController(); let terminal = false, failure: RequestError | null = null, lastPaint = 0;
    const paint = () => { if (!mounted.current) return; const copy = { ...reply, meta: { ...reply.meta, stages: [...(reply.meta?.stages || [])] } }; commit(items => items.map(item => item.id === sessionId ? { ...item, messages: item.messages.map(message => message.id === copy.id ? copy : message) } : item)); };
    function handle(event: StreamEvent) {
      if (!reply.meta) return;
      if (event.event === 'accepted') reply.meta.request_id = event.request_id;
      if (event.event === 'stage' && event.stage) { const stages = reply.meta.stages!; const index = stages.findIndex(stage => stage.stage === event.stage); const value = { stage: event.stage, created: event.created, elapsed_ms: event.elapsed_ms, gateway_request_id: event.gateway_request_id }; if (index < 0) stages.push(value); else stages[index] = value; if (event.gateway_request_id) reply.meta.gateway_request_id = event.gateway_request_id; setLiveStatus(stageNames[event.stage] || event.stage); }
      if (event.event === 'decision') reply.meta = { ...reply.meta, ...event };
      if (event.event === 'token') reply.content = textContent(reply.content) + (event.text || '');
      if (event.event === 'done') { terminal = true; reply.content = event.answer ?? reply.content; reply.meta = { ...reply.meta, ...event, stages: [...(reply.meta.stages || []), { stage: 'completed', created: event.created }] }; setLiveStatus(t("回答完成")); if(event.context_saved===false)setNotice(t("回答已完成，但服务端未保存本轮上下文；后续项目任务可能无法接续，请补充必要背景。")); }
      if (event.event === 'error') { terminal = true; failure = { code: event.code || 'gateway_error', error: event.error || t("请求未完成"), reason_code: event.reason_code, category: event.category, upstream_error_code: event.upstream_error_code, review_source: event.review_source, http_status: event.http_status, request_id: event.request_id, gateway_request_id: event.gateway_request_id, failure_stage: event.failure_stage || reply.meta.stages?.at(-1)?.stage }; reply.meta = { ...reply.meta, ...event, error: failure }; }
      if (event.event !== 'token' || performance.now() - lastPaint > 70) { paint(); lastPaint = performance.now(); }
    }
    try { const response = await fetch('/api/chat', { method: 'POST', signal: controller.current.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: payload, mode, scope, decision_engine:decisionEngine, documents:sentDocuments.map(d=>d.id), max_tokens: 768, conversation_id:sessionId,turn_id:user.id,project:current.project||null }) }); await consumeEvents(response, handle); if (!terminal) throw new StreamRequestError({ code: 'stream_interrupted', error: '回答传输中断，请重试。' }); }
    catch (error) { if (!terminal) { const result = requestError(error); failure = { ...result, failure_stage: result.failure_stage || reply.meta?.stages?.at(-1)?.stage || 'submission' }; reply.meta = { ...reply.meta, request_id: failure.request_id || reply.meta?.request_id, gateway_request_id: failure.gateway_request_id || reply.meta?.gateway_request_id, error: failure }; } }
    finally {
      pendingIds.current.clear();
      if (failure) { const result = failure as RequestError; rejectedDrafts.current.set(reply.meta?.request_id || reply.id, { text: input, images: sentImages, documents:sentDocumentFiles }); const excluded = excludedTurn(user, reply); commit(items => items.map(item => item.id === sessionId ? { ...item, title: item.title === '新对话' ? '受控请求' : item.title, messages: item.messages.map(message => message.id === user.id ? excluded[0] : message.id === reply.id ? excluded[1] : message) } : item), true); setLiveStatus(result.code === 'input_blocked' ? t("AI Gateway 已拦截") : result.code === 'review_unavailable' ? t("审核未完成，已停止") : result.code === 'cancelled' ? t("本轮已取消") : t("本轮未完成")); }
      else { paint(); commit(items => items.map(item => item.id === sessionId && item.title === '新对话' ? { ...item, title: (input || '图片问答').slice(0, 32) } : item), true); }
      if (reply.meta?.gateway_request_id && (!failure || !['input_blocked', 'review_unavailable'].includes((failure as RequestError).code))) void pollMonitor(sessionId, reply.id, reply.meta.gateway_request_id);
      busyRef.current = false; setBusy(false); if((failure as RequestError|null)?.code!=='cancelled'){setCancelPending(false);setActiveConversation(null);} controller.current = null; void refreshHealth();
    }
  }
  function editRejected(message: ChatMessage) { const original = rejectedDrafts.current.get(message.meta?.request_id || message.id); if (original) { setText(original.text); setImages(original.images);setDocuments(original.documents||[]); setNotice(t("已恢复原始草稿，请修改后重新发送。")); } else setNotice(t("原始阻断内容没有持久化，请重新输入。")); }
  function restoreDraft(message:ChatMessage) {
    if(allBusy)return;
    const run=message.runId?runsRef.current[message.runId]:undefined;
    const saved=rejectedDrafts.current.get(message.runId||message.meta?.request_id||message.id);
    const index=current.messages.findIndex(m=>m.id===message.id),previous=current.messages.slice(0,index).reverse().find(m=>m.role==='user');
    const prompt=saved?.text||(run?.events.find(e=>e.type==='prompt')?.data.text as string|undefined)||(!previous?.excluded&&previous?textContent(previous.content):'');
    if(!prompt){setNotice(t("原始内容没有持久化，请重新输入。"));return;}
    if(text.trim()&&text!==prompt){setNotice(t("输入框已有草稿，请先保存或清空，再恢复本轮问题。"));return;}
    const snapshot=message.snapshot||previous?.snapshot;
    if(snapshot){
      if(snapshot.project&&!agentHealth?.projects.some(p=>p.id===snapshot.project)){setNotice(t("原项目当前未获授权，请重新选择项目。"));return;}
      commit(items=>items.map(item=>item.id===currentId?{...item,project:snapshot.project}:item),true);
      setMode(snapshot.model);setScope(snapshot.scope||'local');setDecisionEngine(snapshot.decisionEngine||'laya');setFiles(snapshot.files||[]);
    }
    setText(prompt);setImages(saved?.images||[]);setDocuments(saved?.documents||[]);setNotice(t("已恢复本轮草稿与模型设置，请确认后发送；会重新审核并逐次审批。"));
  }
  function addDocuments(input:FileList|File[]){
    if(allBusy)return;
    const next=[...documents];
    for(const file of Array.from(input)){
      if(!/\.(pdf|docx)$/i.test(file.name)){setNotice(t("文档仅支持 PDF 和 DOCX；旧版 DOC 请另存为 DOCX。"));return;}
      if(!file.size||file.size>10*1024*1024){setNotice(t("单份文档需大于0且不超过10 MiB。"));return;}
      if(next.length>=3){setNotice(t("每轮最多添加3份文档。"));return;}next.push(file);
    }
    setDocuments(next);setNotice(t("仅提取并审核可读取文字；不识别扫描页和图片文字。文档将在发送时上传设备并审核。"));
  }
  async function addFiles(files: FileList | File[]) {
    if (busyRef.current) return; const result = [...images];
    try { for (const file of Array.from(files)) { if (result.length >= 4) throw new Error(t("最多添加4张图片。")); if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error(t("支持PNG、JPEG、WebP，原文件不超过8MB。")); const image = await createImageBitmap(file), scale = Math.min(1, 1024 / Math.max(image.width, image.height)), canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale)); canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height); result.push(canvas.toDataURL('image/jpeg', .88)); image.close(); } setImages(result); setNotice(t("图片只在本地处理。先检查图片内容，再由 AI Gateway 审核；识别不确定或审核失败会停止。")); } catch (error) { setNotice(gatewayDisplayText((error as Error).message)); }
  }
  async function setProject(project:string|null){
    if(allBusy)return;
    if(project&&!agentHealth?.projects.some(p=>p.id===project)){setNotice(t("项目未获授权或已归档。"));return;}
    if((current.project||null)===project)return;
    if(project&&(current.boundProject||current.project)&&(current.boundProject||current.project)!==project){createSession(project);setNotice(t("已打开新会话，原会话保留在原项目中。"));return;}
    if(project&&!config.demo){try{await agentApi('/conversations',{id:current.id,project});}catch(e){setNotice(gatewayDisplayText((e as Error).message));return;}}
    commit(items=>items.map(s=>s.id===currentId?{...s,project,boundProject:project||s.boundProject||s.project}:s),true);setFiles([]);if(project){setScope('local');try{setAvailableFiles((await agentApi<ProjectFiles>('/projects/'+project+'/files')).files);}catch(e){setNotice(gatewayDisplayText((e as Error).message));}}
  }
  async function approve(run:AgentRunView,allowed:boolean){if(!run.approval)return;setAgentPending(true);try{await agentApi('/runs/'+run.id+'/approve',{id:run.approval.id,digest:run.approval.digest,allowed,conversationId:run.conversationId,turnId:run.turnId});acceptRun(await agentApi<AgentRunView>('/runs/'+run.id));}catch(e){setNotice(gatewayDisplayText((e as Error).message));}finally{setAgentPending(false);}}
  async function stop(){if(busyRef.current){setCancelPending(true);controller.current?.abort();return;}if(agentHealth?.active){setCancelPending(true);try{const run=await agentApi<AgentRunView>('/runs/'+agentHealth.active);processingAgent.current=run.id;await agentApi('/runs/'+run.id+'/cancel',{conversationId:run.conversationId,turnId:run.turnId});}catch(e){setNotice(gatewayDisplayText((e as Error).message));setCancelPending(false);}}}
  return { documents,setDocuments,addDocuments,hasDocuments, sessions, current, text, setText, images, setImages, mode, setMode, scope, setScope, decisionEngine, setDecisionEngine, health, authorized, sessionStatus, refreshSession, busy:allBusy, notice, setNotice, liveStatus, connectionError, createSession, chooseSession, rename, send, stop, editRejected, restoreDraft, addFiles, refreshHealth, workMode,turnPlan,toolMode,files,setFiles,availableFiles,setProject,agentHealth,runs,approve,agentPending,cancelPending,activeConversation,projects:projects.length?projects:(agentHealth?.projects||[]),projectDialog,setProjectDialog,projectError,refreshProjects,projectRequest,createProject,updateProject,openProject };
}

const decisionEngineNames = localizedLabels(rawDecisionEngineNames);
