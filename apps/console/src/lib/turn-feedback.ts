import { t } from "./i18n.ts";
import type { AgentRunView, ReplyMeta } from './types';

export function decisionSource(source?: string, classifierUsed?: boolean) {
  if(source==='manual'||source==='baseline')return t("手动指定");
  if(source==='fallback'||source==='availability')return t("可用性回退");
  if(classifierUsed)return t("本地决策模型");
  if(source==='rule')return t("规则识别");
  if(source==='scope')return t("调用范围限制");
  if(source==='cache')return t("复用任务判断");
  return source ? t("任务路由") : t("来源未记录");
}

export function chatTurnFeedback(meta: ReplyMeta) {
  const stages=meta.stages||[],has=(stage:string)=>stages.some(e=>e.stage===stage);
  const stopped=meta.error?.code==='input_blocked'||meta.error?.code==='review_unavailable';
  const generated=Boolean(meta.actual_upstream_model||has('generating')||has('completed')&&!meta.error);
  const model=stopped?t("未调用回答模型"):generated?(meta.model||meta.actual_upstream_model||t("实际模型未记录")):meta.selected?t("已选模型，尚无执行回执"):t("尚无模型执行回执");
  const input=meta.error?.code==='input_blocked'?t("已拦截"):meta.error?.code==='review_unavailable'?t("审核未完成，已停止"):has('input_passed')?t("检查通过"):has('input_checking')?t("检查中"):t("结果未记录");
  return {model,reason:meta.fallback||meta.decision?.reason||(meta.mode&&meta.mode!=='auto'?t("手动指定，跳过自动决策"):t("选模原因未记录")),source:decisionSource(meta.decision?.source||(meta.mode&&meta.mode!=='auto'?'manual':undefined),meta.decision?.classifier_used),input,output:stopped?t("未产生回答输出"):meta.output_policy==='stream_no_output_review'?t("普通聊天未启用输出审核"):t("输出审核结果未记录"),blocked:meta.error?.code==='input_blocked',elapsedMs:meta.elapsed_ms,tool:undefined as string|undefined};
}

export function agentTurnFeedback(run: AgentRunView) {
  const decision=run.events.find(e=>e.type==='decision')?.data;
  const protections=run.events.filter(e=>e.type==='protection');
  const inputResult=protections.filter(e=>e.data.direction==='input').at(-1)?.data;
  const outputBlock=protections.find(e=>['output','tool_output'].includes(String(e.data.direction))&&e.data.verdict==='block');
  const outputAllow=protections.some(e=>e.data.direction==='output'&&e.data.verdict==='allow');
  const toolInput=protections.filter(e=>e.data.direction==='tool_input').at(-1)?.data;
  const toolOutput=protections.filter(e=>e.data.direction==='tool_output').at(-1)?.data;
  const generated=run.events.some(e=>['answer','answer_delta','usage'].includes(e.type));
  const inputPassed=run.events.some(e=>e.type==='hook'&&e.data.stage==='UserPromptSubmit'&&e.data.verdict==='allow');
  const model=generated?(run.selected==='cloud'?'DeepSeek':run.selected==='standard'?'Qwen3.5-9B':t("实际模型未记录")):run.selected?t("已选模型，尚无执行回执"):t("未记录模型调用");
  return {model,reason:String(decision?.reason||t("选模原因未记录")),source:decisionSource(typeof decision?.source==='string'?decision.source:undefined,decision?.classifier_used===true),input:inputResult?.verdict==='block'?t("已拦截"):inputResult?.verdict==='unavailable'?t("审核未完成，已停止"):inputPassed?t("检查通过"):t("结果未记录"),output:outputBlock?outputBlock.data.scope==='project'?t("工具结果审核已拦截"):t("项目敏感输出已拦截"):toolOutput?.verdict==='unavailable'?t("工具结果审核未完成，已停止"):outputAllow?t("项目回答敏感模式检查通过"):!generated&&inputResult?t("未产生回答输出"):t("项目回答检查结果未记录"),blocked:protections.some(e=>e.data.verdict==='block'),elapsedMs:undefined,tool:toolInput?.verdict==='block'?t("工具调用已拦截"):toolInput?.verdict==='unavailable'?t("工具审核未完成，已停止"):undefined};
}
