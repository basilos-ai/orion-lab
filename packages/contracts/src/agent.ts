import {parseDecisionEngine, type DecisionEngine} from './decision-engines.ts';
export type AgentModel = 'auto' | 'standard' | 'cloud';
export type AgentScope = 'local' | 'hybrid';
export interface AgentOutputSpec { format:'text'|'json'; schema?:Record<string,unknown> }
export type AgentPhase = 'checking' | 'running' | 'awaiting_approval' | 'completed' | 'blocked' | 'failed' | 'cancelled';
export type HookStage = 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse';
export interface AgentEvent { seq: number; at: string; type: string; data: Record<string, unknown> }
export interface ApprovalView { id: string; tool: string; digest: string; summary: string; preview: string; expiresAt: string; file?: string; before?: string; after?: string }
export interface AgentRunView { id: string; project: string; model: AgentModel; scope?: AgentScope; decisionEngine?:DecisionEngine; output?:AgentOutputSpec; access?: 'read' | 'edit'; selected: string; phase: AgentPhase; created: string; events: AgentEvent[]; approval?: ApprovalView; conversationId?: string; turnId?: string; files?: string[] }
export type AgentStreamFrame = { event: 'snapshot'; run: AgentRunView } | { event: 'entry'; entry: AgentEvent; run: Omit<AgentRunView, 'events'> } | { event: 'heartbeat' };
/** Completed answers replace their preview; legacy unkeyed answers remain readable. */
export function answerSegments(events: AgentEvent[]) {
  const parts = new Map<string, { id: string; text: string; complete: boolean }>();
  const seen = new Set<number>();
  for (const event of events) {
    if (seen.has(event.seq)) continue; seen.add(event.seq);
    if (event.type !== 'answer' && event.type !== 'answer_delta') continue;
    const id = event.data.message === undefined ? `legacy-${event.seq}` : String(event.data.message);
    const prior = parts.get(id) || { id, text: '', complete: false };
    parts.set(id, event.type === 'answer' ? { id, text: String(event.data.text || ''), complete: true } : prior.complete ? prior : { ...prior, text: prior.text + String(event.data.text || '') });
  }
  return [...parts.values()];
}
export interface AgentHealth { ready: boolean; nativeHooks: boolean; hookMode: 'policy_bridge'; explanation: string; projects: import('./projects.ts').ProjectSummary[]; models: { id: AgentModel; label: string }[]; active?: string }
export function parseAgentOutput(value:unknown,prompt:string):AgentOutputSpec {
  if(value===undefined)return {format:/(?:最终|只|仅|严格).{0,8}(?:输出|返回)\s*(?:合法|有效|标准)?\s*JSON|(?:输出|返回)\s*JSON\s*(?:对象|格式)|(?:output|return|respond)\s+(?:only\s+|valid\s+)?JSON\b/i.test(prompt)?'json':'text'};
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid_output');
  const p=value as Record<string,unknown>;
  if(Object.keys(p).some(k=>!['format','schema'].includes(k))||!['text','json'].includes(String(p.format)))throw new Error('invalid_output');
  if(p.schema!==undefined){
    if(p.format!=='json'||JSON.stringify(p.schema).length>4096)throw new Error('invalid_output_schema');
    const validate=(s:unknown,depth=0):void=>{
      if(depth>6||!s||typeof s!=='object'||Array.isArray(s))throw new Error('invalid_output_schema');
      const r=s as Record<string,any>,allowed=['type','properties','required','additionalProperties','items','enum'];
      if(Object.keys(r).some(k=>!allowed.includes(k))||!['object','array','string','number','integer','boolean','null'].includes(r.type))throw new Error('invalid_output_schema');
      if(r.properties!==undefined){if(r.type!=='object'||!r.properties||typeof r.properties!=='object'||Array.isArray(r.properties)||Object.keys(r.properties).length>50)throw new Error('invalid_output_schema');for(const s of Object.values(r.properties))validate(s,depth+1);}
      if(r.required!==undefined&&(!Array.isArray(r.required)||r.required.some((k:unknown)=>typeof k!=='string'||!Object.hasOwn(r.properties||{},k))))throw new Error('invalid_output_schema');
      if(r.additionalProperties!==undefined&&typeof r.additionalProperties!=='boolean')throw new Error('invalid_output_schema');
      if(r.items!==undefined){if(r.type!=='array')throw new Error('invalid_output_schema');validate(r.items,depth+1);}
      if(r.enum!==undefined&&(!Array.isArray(r.enum)||r.enum.length>20||r.enum.some((v:unknown)=>v!==null&&!['string','number','boolean'].includes(typeof v))))throw new Error('invalid_output_schema');
    };validate(p.schema);
  }
  return {format:p.format as 'text'|'json',...(p.schema===undefined?{}:{schema:p.schema as Record<string,unknown>})};
}
export function parseAgentRequest(value: unknown): { project: string; model: AgentModel; scope: AgentScope; decisionEngine:DecisionEngine; output:AgentOutputSpec; prompt: string; access: 'read'|'edit' } {
  if (!value || typeof value !== 'object') throw new Error('invalid_request');
  const p = value as Record<string, unknown>;
  if (typeof p.project !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(p.project) || !['auto', 'standard', 'cloud'].includes(String(p.model)) || typeof p.prompt !== 'string' || !p.prompt.trim() || p.prompt.length > 6000) throw new Error('invalid_request');
  if (p.access !== undefined && p.access !== 'read' && p.access !== 'edit') throw new Error('invalid_access');
  const scope = p.scope === undefined ? 'local' : p.scope;
  if (scope !== 'local' && scope !== 'hybrid') throw new Error('invalid_scope');
  if (p.model === 'cloud' && scope !== 'hybrid') throw new Error('cloud_scope_required');
  return { project: p.project, model: p.model as AgentModel, scope, decisionEngine:parseDecisionEngine(p.decision_engine), output:parseAgentOutput(p.output,p.prompt), prompt: p.prompt.trim(), access: p.access === 'edit' ? 'edit' : 'read' };
}
