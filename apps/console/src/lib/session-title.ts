import { t } from './i18n.ts';
import type { ChatSession } from './types';
/** Persisted protocol placeholders stay stable; user-authored titles are left verbatim. */
export function sessionTitle(session: Pick<ChatSession, 'title' | 'messages'>): string {
  if (session.title === '新对话' && session.messages.length === 0) return t('新对话');
  if (session.title === '受控请求' && session.messages.length > 0 && session.messages.every(message => message.excluded)) return t('受控请求');
  if (session.title === '图片问答' && session.messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type === 'image_url'))) return t('图片问答');
  if (/^Pi 历史任务(?: · .*)?$/.test(session.title)) return session.title.replace('Pi 历史任务', t('Pi 历史任务'));
  return session.title || t('新对话');
}
