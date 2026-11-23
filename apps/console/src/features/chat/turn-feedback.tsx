import { t, diagnosticText, uiText } from '@/lib/i18n';
import type { AgentRunView, ReplyMeta } from '@/lib/types';
import { agentTurnFeedback, chatTurnFeedback } from '@/lib/turn-feedback';
import { milliseconds } from '@/lib/config';

export function TurnFeedback({meta,run}:{meta?:ReplyMeta;run?:AgentRunView}) {
  if(!meta&&!run)return null;
  const facts=run?agentTurnFeedback(run):chatTurnFeedback(meta!);
  return <div className={`turn-feedback ${facts.blocked?'has-block':''}`} role="group" aria-label={t("本轮模型与保护结果")}>
    <div className="turn-feedback-model"><strong>{uiText(facts.model)}</strong>{facts.elapsedMs!=null&&<span>{milliseconds(facts.elapsedMs)}</span>}</div>
    <p><span className="turn-feedback-source">{facts.source}</span>{diagnosticText(facts.reason)}</p>
    <p>{t("输入：")}{facts.input}<span aria-hidden="true"> · </span>{t("输出：")}{facts.output}</p>
    {facts.tool&&<p>{t("工具：")}{facts.tool}</p>}
    {run&&<small>{t("项目回答检查敏感模式；工具结果另经审核。未启用完整的回答语义审核。")}</small>}
    {meta?.finish_reason==='length'&&<small>{t("回答达到输出长度上限，内容可能尚未完成。")}</small>}
  </div>;
}
