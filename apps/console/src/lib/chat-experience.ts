import { t, localizedLabels } from "./i18n.ts";
import {decisionEngineNames as rawDecisionEngineNames} from '@orion/contracts';
import type { AgentRunView, ChatSession } from './types';

/** Describe observed events only, without arbitrary arguments or invented progress. */
export function agentProgress(run:AgentRunView) {
  const repair=run.events.filter(e=>e.type==='format_repair').at(-1);
  if(repair?.data.state==='started')return t("正在校正回答格式");
  if(run.phase==='checking')return run.events.at(-1)?.type==='routing'?t("正在选择合适的模型")+(run.decisionEngine?' · '+decisionEngineNames[run.decisionEngine]:''):t("正在检查输入");
  const tools=new Map<string,{tool:string;path?:string;done:boolean}>();
  for(const e of run.events){
    if(e.type==='tool_start'){const args=e.data.args as {path?:unknown}|undefined;tools.set(String(e.data.id||e.data.tool),{tool:String(e.data.tool),path:typeof args?.path==='string'?args.path:undefined,done:false});}
    if(e.type==='tool_end'||e.type==='tool_error'){const tool=tools.get(String(e.data.id||e.data.tool));if(tool)tool.done=true;}
  }
  const active=[...tools.values()].reverse().find(t=>!t.done);
  if(active){const name=({read_file:t("正在读取文件"),list_files:t("正在浏览项目"),search_files:t("正在搜索项目"),write_file:t("正在修改文件"),run_check:t("正在运行检查")} as Record<string,string>)[active.tool]||t("正在处理项目");return active.path?`${name} · ${active.path}`:name;}
  return tools.size?t("正在整理回答"):t("正在思考");
}

/** Existing history stays untouched; grouping uses known timestamps only. */
export function sessionTime(session:ChatSession,runs:Record<string,AgentRunView>) {
  const times=session.messages.flatMap(m=>[m.runId?runs[m.runId]?.created:undefined,...(m.meta?.stages||[]).map(s=>s.created)]).filter((s):s is string=>Boolean(s)).map(s=>Date.parse(s)).filter(Number.isFinite);
  return times.length?Math.max(...times):null;
}
export function historyGroup(time:number|null,now:Date) {
  if(time===null)return t("其他对话");
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
  if(time>=today)return t("今天");
  const yesterday=new Date(now.getFullYear(),now.getMonth(),now.getDate()-1).getTime();
  return time>=yesterday?t("昨天"):t("更早");
}

const decisionEngineNames = localizedLabels(rawDecisionEngineNames);
