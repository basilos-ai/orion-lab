import type { Mode } from './chat.ts';

export const toolModels: readonly Mode[] = ['auto', 'standard', 'cloud'];
export interface TurnPlanInput { prompt: string; project?: string | null; files: string[]; model: Mode; images: boolean }
/** UI admission guidance, never a substitute for server authorization or per-operation approval. */
export function planTurn(input: TurnPlanInput): { execution: 'answer' | 'tools'; access: 'read' | 'edit'; needsProject: boolean; needsToolModel: boolean; imageTools: boolean } {
  const text = input.prompt.trim();
  const instruction=text.replace(/```[\s\S]*?(?:```|$)/g,'').trim();
  const operation = /(?:读取|查看|搜索|列出|修改|编辑|创建|新建|删除|重命名|运行|执行|检查|修复|更新|写入|保存|优化|重构|替换|添加|增加|补充|read|search|edit|create|write|run|fix|update)[\s\S]{0,48}(?:项目|文件|目录|仓库|测试|检查|README|[\w-]+\.(?:py|ts|tsx|js|json|md)|project|file|directory|repository|test)/i.test(instruction);
  const explanatory = /^(?:请)?(?:解释|说明|介绍|分析|如何|怎么|怎样|什么是|explain|how\b|what\b)/i.test(instruction);
  const inline = /(?:下面|以下|这段)[\s\S]{0,12}(?:代码|文本|内容)|```/.test(text);
  const mutation = /(?:修改|编辑|创建|新建|删除|重命名|运行|执行|修复|更新|写入|保存|优化|重构|替换|添加|增加|补充|改成|改为|edit|create|write|run|fix|update)/i.test(instruction);
  const requested = input.files.length > 0 || operation && !explanatory && (!inline || Boolean(input.project));
  // A selected project admits the tool-capable agent, which may answer without calling tools.
  // Image/direct-only models keep the answer path; explicit file requests need a new admission.
  const tools = Boolean(input.project) && !input.images && toolModels.includes(input.model);
  return { execution: tools ? 'tools' : 'answer', access: Boolean(input.project) && mutation && !explanatory && (!inline || operation) ? 'edit' : 'read', needsProject: requested && !input.project, needsToolModel: requested && Boolean(input.project) && !input.images && !toolModels.includes(input.model), imageTools: requested && input.images };
}
