import { getLocale } from './locale.ts';
import { englishMessages } from './messages.ts';

/** Source-language message IDs keep existing persisted labels compatible. */
export function t(source: string, values: readonly unknown[] = []): string {
  const pattern = getLocale() === 'en-US' && Object.hasOwn(englishMessages, source) ? englishMessages[source] : source;
  return pattern.replace(/\{(\d+)\}/g, (marker, index: string) => Number(index) < values.length ? String(values[Number(index)] ?? '') : marker);
}

/** Evaluate module-level label maps at read time, so a language switch cannot freeze them. */
export function localizedLabels<T extends Record<string, string>>(labels: T): T {
  return new Proxy(labels, { get(target, key, receiver) { const value: unknown = Reflect.get(target, key, receiver); return typeof value === 'string' ? t(value) : value; } });
}

// Only use this for application-owned notices, never for prompts, answers or file contents.
const reverse = new Map(Object.entries(englishMessages).map(([zh, en]) => [en, zh]));
function escapePattern(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const patterns = Object.entries(englishMessages).flatMap(([source, target]) => {
  if (!/\{\d+\}/.test(source)) return [];
  return [source, target].map(pattern => ({ source, expression: new RegExp('^' + pattern.split(/(\{\d+\})/).map(piece => /^\{\d+\}$/.test(piece) ? '([\\s\\S]*?)' : escapePattern(piece)).join('') + '$'), indexes: [...pattern.matchAll(/\{(\d+)\}/g)].map(match => Number(match[1])) }));
});
function resolveMessage(value: string): { source: string; values?: unknown[] } | undefined {
  if (['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.'].includes(value)) return { source: '网络连接失败，请检查连接后重试。' };
  if (Object.hasOwn(englishMessages, value)) return { source: value };
  const source = reverse.get(value); if (source) return { source };
  for (const pattern of patterns) {
    const match = pattern.expression.exec(value); if (!match) continue;
    const values: unknown[] = []; pattern.indexes.forEach((index, at) => { values[index] = match[at + 1]; });
    return { source: pattern.source, values };
  }
}
export function uiText(value: string): string { const message = resolveMessage(value); return message ? t(message.source, message.values) : value; }

export function diagnosticText(value: unknown): string {
  if (typeof value !== 'string' || !value || value === '—') return '—';
  const message = resolveMessage(value);
  if (message) {
    const engines = new Set(['Qwen3.5-2B · 后摩', 'Qwen3.5-4B · 后摩', 'Qwen3.5-9B · 后摩']);
    const values = message.values?.map(item => typeof item === 'string' && engines.has(item) ? t(item) : item);
    return t(message.source, values);
  }
  // Technical identifiers remain useful in either language, but arbitrary prose is not UI copy.
  if (/^[a-zA-Z0-9_.:/+-]{1,100}$/.test(value)) return value;
  return t('诊断详情暂无对应译文，请参考诊断代码。');
}

/** Unknown service messages are not shown as untranslated prose. Keep the diagnostic code. */
export function errorText(value: unknown, code?: string): string {
  const text = value instanceof Error ? value.message : typeof value === 'string' ? value : '';
  if (!code && /^[a-z][a-z0-9_]{2,79}$/.test(text)) code = text;
  const message = resolveMessage(text);
  // Preserve specific service guidance; a generic HTTP/network label must not hide a structured code.
  if (message && !['请求失败 {0}', '网络连接失败，请检查连接后重试。'].includes(message.source)) return t(message.source, message.values);
  const coded: Record<string, string> = {
    input_blocked: '请求被 AI Gateway 输入保护拦截，请移除敏感内容或改写后重发。',
    review_unavailable: '输入审核未完成，已停止，未调用回答模型。',
    device_busy: '另一个任务正在处理，请稍后重试。', agent_busy: '另一个任务正在处理，请稍后重试。',
    session_required: '设备会话已失效，请刷新后重新提交。', cloud_limit: '今日云端调用达到服务端限额。',
    model_unavailable: '所选模型尚未就绪，请稍后重试。', connection_error: '网络连接失败，请检查连接后重试。',
    model_not_ready: '所选模型尚未就绪，请稍后重试。',
    service_unavailable: '服务暂不可用，请稍后重试。', agent_unavailable: '会话服务暂不可用，请稍后重试。',
    request_timeout: '请求超时，请稍后重试。', permission_denied: '当前设备无权执行此请求。',
    stream_interrupted: '回答传输中断，请重试。', stream_protocol_error: '回答服务返回了无法读取的响应，请重试。',
    document_denied: '文档已失效或不属于当前会话，请重新上传或新建对话。',
    document_expired: '文档已过期，请重新上传后继续。',
  };
  if (code && Object.hasOwn(coded, code)) return t(coded[code]);
  if (message) return t(message.source, message.values);
  const generic = t('请求未能完成，请稍后重试。');
  return code && /^[a-zA-Z0-9_.:-]{1,80}$/.test(code) ? `${generic} (${code})` : generic;
}
