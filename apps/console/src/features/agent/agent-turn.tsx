import { t, localizedLabels, diagnosticText, uiText } from '@/lib/i18n';
import {decisionEngineNames as rawDecisionEngineNames} from '@orion/contracts';
import { useEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, Clock3, LoaderCircle, ShieldCheck, Terminal, X, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { answerSegments, type AgentRunView, type AgentEvent } from '@orion/contracts';
import { diffLines } from '@/lib/workspace';
import { gatewayDisplayText } from '@/lib/gateway-brand';
import { agentProgress } from '@/lib/chat-experience';
import { WaitingFeedback } from '../chat/answer-feedback';
import { TurnFeedback } from '../chat/turn-feedback';

export const phaseNames = { get checking() { return t("审核输入"); },get running() { return t("正在执行"); },get awaiting_approval() { return t("等待你的审批"); },get completed() { return t("已完成"); },get blocked() { return t("已拦截"); },get failed() { return t("执行失败"); },get cancelled() { return t("已停止"); } };
const errors:Record<string,string>={get policy_blocked() { return t("安全审核拒绝了本次内容。"); },get approval_denied() { return t("本次操作未获得审批。"); },get bridge_unavailable() { return t("审核服务暂不可用，已停止。"); },get model_failed() { return t("模型未完成本轮任务。"); },get agent_failed() { return t("本轮任务未完成，请展开工具记录查看原因。"); },get tool_failed() { return t("文件或工具操作未完成，请检查输入。"); },get sensitive_tool_content() { return t("工具内容触发敏感信息保护，已停止。"); },get hook_content_budget() { return t("工具数据超出安全审核预算，已停止。"); },get cloud_scope_required() { return t("仅本地模式禁止调用云端。"); },get cloud_unavailable() { return t("云端未配置或额度不足，请选择可用的本地模型。"); },get model_not_ready() { return t("本地9B尚未就绪，请手动加载9B；仅本地不会调用云端。"); },get context_budget() { return t("上下文过长，请减少文件或开始新对话。"); }};
export function FileDiff({before,after}:{before:string;after:string}) {return <div className="file-diff" tabIndex={0} role="region" aria-label={t("文件修改差异")}><div className="diff-heading">{t("原行号 / 新行号 · 删除 − / 新增 ＋")}</div>{diffLines(before,after).map((line,i)=><div className={`diff-line diff-${line.kind}`} key={i}><span>{line.old||''}</span><span>{line.next||''}</span><code>{line.kind==='remove'?'−':line.kind==='add'?'＋':' '} {line.text||' '}</code></div>)}</div>;}
export function AgentTurn({run,approve,pending,markdown}:{run?:AgentRunView;approve:(run:AgentRunView,allowed:boolean)=>Promise<void>;pending:boolean;markdown:(text:string)=>React.ReactNode}){
  const region=useRef<HTMLElement>(null),[clock,setClock]=useState(Date.now());
  useEffect(()=>{if(run?.approval){region.current?.focus();region.current?.scrollIntoView({block:'nearest'});const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);}},[run?.approval?.id]);
  if(!run)return <p className="subtle" role="status">{t("正在恢复对话…")}</p>;
  const approval=run.approval,seconds=approval?Math.max(0,Math.ceil((Date.parse(approval.expiresAt)-clock)/1000)):0;
  const answers=answerSegments(run.events),active=['checking','running'].includes(run.phase);
  const decision=run.events.find(e=>e.type==='decision')?.data;
  const changes=approval?.before!==undefined&&approval.after!==undefined?diffLines(approval.before,approval.after):null;
  const problem=run.events.filter(e=>e.type==='error'||e.type==='tool_error').at(-1);
  const code=String(problem?.data.code||''),message=errors[code]||t("本次请求未完成，请重试或查看详情。");
  return <article className="unified-agent-turn" aria-label={t("Pi 执行记录")}>
    <div className="agent-turn-header"><span className="assistant-symbol"><Terminal/></span><strong>Orion</strong>{run.selected&&<span className="message-model">{run.selected==='cloud'?'DeepSeek':'Qwen3.5-9B'}</span>}</div>
    {(decision?.fallback||decision?.reason_code==='local_unavailable')&&<p className="notice" role="status">{diagnosticText(gatewayDisplayText(String(decision.reason)))}</p>}
    {active&&!answers.some(a=>a.text)&&!approval&&<WaitingFeedback label={agentProgress(run)} startedAt={run.created}/>}
    {answers.map(answer=><div className="agent-answer" data-message={answer.id} data-complete={answer.complete} data-streaming={active&&!answer.complete} key={answer.id}>{markdown(answer.text)}</div>)}
    {approval&&<section className="agent-approval" ref={region} tabIndex={-1} aria-label={t("待审批操作")}><div><ShieldCheck /><h2>{uiText(approval.summary)}</h2></div><p className="approval-impact">{changes?t("1 个文件 · 新增 {0} 行，删除 {1} 行", [changes.filter(l=>l.kind==='add').length, changes.filter(l=>l.kind==='remove').length]):t("只执行下方列出的本次操作")}</p><p>{t("确认后才会执行此操作 ·")}{seconds>0?<span aria-hidden="true">{seconds}{t("秒内有效")}</span>:t("确认已过期，请结束本轮后重新提交")}<span className="sr-only">{t("本次授权90秒内有效")}</span></p><div className="approval-preview">{approval.before!==undefined&&approval.after!==undefined?<FileDiff before={approval.before} after={approval.after}/>:<pre tabIndex={0}>{uiText(approval.preview)}</pre>}</div><div className="agent-approval-actions"><Button variant="outline" disabled={pending||!seconds} onClick={()=>void approve(run,false)}><X />{t("拒绝")}</Button><Button disabled={pending||!seconds} onClick={()=>void approve(run,true)}><Check />{t("允许本次")}</Button></div></section>}
    {problem&&<div className="notice" role="status"><p>{code==='approval_denied'?t("你已拒绝本次操作。"):message}</p>{!run.selected&&['blocked','failed'].includes(run.phase)&&<span>{t("未调用模型")}</span>}</div>}
    {run.phase==='cancelled'&&!problem&&<p className="subtle" role="status">{t("本轮已停止。")}</p>}
    <TurnFeedback run={run}/>
    {run.events.some(e=>e.type==='context_persistence_error')&&<p className="notice" role="status">{t("对话未能保存，继续时请补充必要背景。")}</p>}
  </article>;
}

function AgentToolDetails({run}:{run:AgentRunView}) {
  const tools=new Map<string,{start?:AgentEvent;end?:AgentEvent;error?:AgentEvent}>();
  for(const event of run.events){if(!['tool_start','tool_end','tool_error'].includes(event.type))continue;const id=String(event.data.id||event.data.tool);const item=tools.get(id)||{};item[event.type==='tool_start'?'start':event.type==='tool_end'?'end':'error']=event;tools.set(id,item);}
  const approval=run.approval;
  return <div className="agent-tool-details">    {[...tools.entries()].map(([id,item])=>{
      const tool=String((item.start||item.end||item.error)?.data.tool),args=item.start?.data.args as Record<string,unknown>|undefined;
      const waiting=approval?.tool===tool&&!item.end&&!item.error,Icon=item.error?XCircle:item.end?CheckCircle2:waiting?Clock3:Terminal;
      const elapsed=item.start&&item.end?Date.parse(item.end.at)-Date.parse(item.start.at):NaN;
      return <details className={`agent-tool ${item.error?'tool-failed':item.end?'tool-complete':waiting?'tool-waiting':''}`} key={id}><summary><Icon aria-hidden="true"/><span className="tool-label"><strong>{({list_files:t("浏览项目"),read_file:t("读取文件"),search_files:t("搜索内容"),write_file:t("修改文件"),run_check:t("运行检查")} as Record<string,string>)[tool]||tool}</strong><span>{typeof args?.path==='string'?args.path:tool}</span></span><small>{item.error?t("已停止"):item.end?t("已完成"):waiting?t("等待审批"):t("执行中")}{Number.isFinite(elapsed)&&<span> · {(elapsed/1000).toFixed(1)} s</span>}</small></summary>{item.start&&<div className="tool-evidence"><span>{t("工具参数")}</span><pre tabIndex={0} aria-label={t("工具参数")}>{JSON.stringify(item.start.data.args,null,2)}</pre></div>}{item.end&&<div className="tool-evidence"><span>{t("执行结果")}</span><pre tabIndex={0} aria-label={t("工具结果")}>{String(item.end.data.result)}</pre></div>}{item.error&&<p className="notice">{errors[String(item.error.data.code)]||String(item.error.data.code)}</p>}</details>;
    })}
</div>;
}

export function AgentInspector({run,projectName}:{run:AgentRunView;projectName?:string}) {
  const context=run.events.find(e=>e.type==='context')?.data;
  const selected=run.selected==='cloud'?t("DeepSeek · 云端"):run.selected?t("Qwen3.5-9B · 后摩"):t("尚未调用");
  const decision=run.events.find(e=>e.type==='decision')?.data,usage=run.events.filter(e=>e.type==='usage').map(e=>e.data);
  const attempts=run.events.filter(e=>e.type==='protocol_attempt'), repairs=run.events.filter(e=>e.type==='format_repair');
  const fields=[[t("输出要求"),run.output?.format==='json'?t("严格JSON"):t("文本／旧任务未记录")],[t("协议校验"),attempts.length?t("{0} / {1} 次有效", [attempts.filter(e=>e.data.valid).length, attempts.length]):t("旧任务无协议回执")],[t("格式纠正"),repairs.length?repairs.at(-1)?.data.state==='completed'?t("已完成一次"):t("未完成"):t("未触发")],[t("执行状态"),phaseNames[run.phase]],[t("本轮模式"),run.access==='edit'?t("Agent · 逐次审批"):t("Agent · 只读")],[t("调用范围"),run.scope==='hybrid'?t("允许云端"):run.scope==='local'?t("仅本地"):t("旧任务未记录")],[t("实际模型"),selected],[t("选模依据"),diagnosticText(gatewayDisplayText(String(decision?.reason||t("旧任务无判决记录"))))],[t("判决来源"),gatewayDisplayText(diagnosticText(String(decision?.source||'—')))],[t("判决耗时"),decision?`${Number(decision.elapsed_ms).toFixed(1)} ms${decision.cache_hit?t(" · 缓存命中"):''}`:'—'],[t("决策模型"),decisionEngineNames[run.decisionEngine||'laya']],[t("判决类别"),String(decision?.choice||t("跳过／未完成"))],[t("概率（仅Laya，未校准）"),decision?.probabilities?JSON.stringify(decision.probabilities):'—'],[t("任务内模型"),t("锁定，不跨模型重放工具")],[t("输入 / 输出Token"),usage.length?`${usage.reduce((n,u)=>n+Number(u.input_tokens||0),0)} / ${usage.reduce((n,u)=>n+Number(u.output_tokens||0),0)}`:t("暂无用量回执")],[t("费用"),t("以 AI Gateway 实际用量回执为准")],[t("项目"),projectName||run.project],[t("会话接续"),context?t("{0} 条已完成消息", [Number(context.messages)]):t("暂无上下文记录")],[t("工具完成"),t("{0} / {1} 次", [run.events.filter(e=>e.type==='tool_end').length, run.events.filter(e=>e.type==='tool_start').length])],[t("安全审核"),t("{0} 次策略桥接记录", [run.events.filter(e=>e.type==='hook').length])],[t("输入保护"),t("AI Gateway Block · 异常停止")],[t("执行后观测"),t("选模 Monitor（复用判决）")],[t("输出策略"),t("项目回答检查敏感模式；工具结果另经审核；未启用完整回答语义审核")]];
  const terminal=['completed','failed','cancelled','blocked'].includes(run.phase),last=run.events.at(-1)?.at;
  const elapsed=last?Math.max(0,(Date.parse(last)-Date.parse(run.created))/1000):NaN;
  return <><div className="execution-summary"><strong>{phaseNames[run.phase]}</strong><span>{selected}</span><small>{terminal&&Number.isFinite(elapsed)?t("本轮约 {0} 秒", [elapsed.toFixed(1)]):t("任务进行中")}</small></div><AgentToolDetails run={run}/><details className="execution-advanced"><summary>{t("审核与技术详情")}</summary><dl className="execution-fields">{fields.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><details className="hook-summary"><summary><ShieldCheck/>{t("安全审核记录 ·")}{run.events.filter(e=>e.type==='hook').length}{t("项")}</summary>{run.events.filter(e=>e.type==='hook').map(e=><div className="agent-hook" key={e.seq}><Check/><span>{({UserPromptSubmit:t('输入校验'),PreToolUse:t('工具调用前'),PostToolUse:t('工具调用后')} as Record<string,string>)[String(e.data.stage)] || String(e.data.stage)}</span><small>{({allow:t('允许'),block:t('阻断'),unavailable:t('无法完成')} as Record<string,string>)[String(e.data.verdict)] || String(e.data.verdict)}</small></div>)}</details><details className="inspector-identifiers"><summary>{t("执行标识与接入说明")}</summary><p>{t('任务 ID：')}{run.id}</p><p>{t('会话 ID：')}{run.conversationId||t("旧版独立任务")}</p><p>{t("Pi 使用策略桥接；AI Gateway 原生 Agent Hooks 暂未支持 Pi 来源。")}</p></details></details></>;
}

const decisionEngineNames = localizedLabels(rawDecisionEngineNames);
