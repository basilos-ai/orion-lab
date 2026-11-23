import type { StreamEvent, ChatMessage, ChatSession, Content, RequestError } from './types';
export class StreamRequestError extends Error {
  details: RequestError;
  constructor(details: RequestError) { super(details.error); this.name = 'StreamRequestError'; this.details = details; }
}
export function requestError(error: unknown): RequestError {
  if (error instanceof StreamRequestError) return error.details;
  if (error instanceof Error && error.name === 'AbortError') return { code: 'cancelled', error: '已停止本轮。已产生的上游用量仍可能计费。' };
  if (error instanceof Error && error.name === 'TimeoutError') return { code: 'request_timeout', error: '请求超时，请稍后重试。' };
  if (error instanceof TypeError && /^(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.)$/.test(error.message)) return { code: 'connection_error', error: '网络连接失败，请检查连接后重试。' };
  return { code: 'request_failed', error: '请求未能完成，请稍后重试。' };
}
function httpError(body: unknown, response: Response): RequestError {
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const detail = record.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : record;
  const statusCode = response.status === 401 ? 'session_required' : response.status === 403 ? 'permission_denied' : response.status === 429 ? 'device_busy' : [408,504].includes(response.status) ? 'request_timeout' : response.status >= 500 ? 'service_unavailable' : 'http_error';
  const code = typeof detail.code === 'string' ? detail.code : typeof record.code === 'string' ? record.code : typeof record.error === 'string' && /^[a-z][a-z0-9_]{2,79}$/.test(record.error) ? record.error : statusCode;
  const result: RequestError = { code, error: typeof record.error === 'string' ? record.error : typeof detail.message === 'string' ? detail.message : `请求失败 ${response.status}`, http_status: response.status };
  for (const key of ['reason_code', 'category', 'upstream_error_code', 'request_id', 'gateway_request_id', 'failure_stage'] as const) {
    const value = detail[key] ?? record[key]; if (typeof value === 'string') result[key] = value;
  }
  if (['document','image','text'].includes(String(detail.review_source))) result.review_source = detail.review_source as RequestError['review_source'];
  result.request_id ||= response.headers.get('X-Request-ID') || undefined;
  return result;
}
export function splitEvents(buffer: string, chunk: string, ended = false) {
  const lines = (buffer + chunk).split('\n'); const rest = ended ? '' : lines.pop() || '';
  return { events: lines.filter(line => line.trim()).map(line => JSON.parse(line) as StreamEvent), rest };
}
export async function consumeEvents(response: Response, onEvent: (value: StreamEvent) => void) {
  if (!response.ok) throw new StreamRequestError(httpError(await response.json().catch(() => null), response));
  if (!response.body) throw new StreamRequestError({ code: 'stream_protocol_error', error: '回答服务返回了无法读取的响应，请重试。' });
  const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); }
      catch (error) { if (error instanceof Error && error.name === 'AbortError') throw error; throw new StreamRequestError({ code: 'stream_interrupted', error: '回答传输中断，请重试。' }); }
      const { value, done } = chunk, lines = (buffer + decoder.decode(value || new Uint8Array(), { stream: !done })).split('\n');
      buffer = done ? '' : lines.pop() || '';
      for (const line of lines.filter(line => line.trim())) {
        let event: StreamEvent;
        try { event = JSON.parse(line); if (!event || typeof event.event !== 'string') throw new Error(); }
        catch { throw new StreamRequestError({ code: 'stream_protocol_error', error: '回答服务返回了无法读取的响应，请重试。' }); }
        onEvent(event);
        // A confirmed block or completed answer is final, even if the socket closes badly afterwards.
        if (event.event === 'done' || event.event === 'error') return;
      }
      if (done) break;
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export function textContent(content: Content): string { return typeof content === 'string' ? content : content.filter(part => part.type === 'text').map(part => part.text).join('\n'); }
export function modelHistory(messages: ChatMessage[]) { return messages.filter(message => !message.excluded).map(({ role, content }) => ({ role, content })); }
export function excludedTurn(user: ChatMessage, reply: ChatMessage) {
  const code = reply.meta?.error?.code;
  const exclusionReason = ['input_blocked','review_unavailable'].includes(code || '') ? 'protection' : code === 'cancelled' ? 'cancelled' : 'incomplete';
  const content = exclusionReason === 'protection' ? '[本轮未进入后续模型上下文，原始输入未持久化]' : exclusionReason === 'cancelled' ? '[本轮已取消，未纳入后续对话上下文，原始输入未持久化]' : '[本轮未完成，未纳入后续对话上下文，原始输入未持久化]';
  return [{ ...user, excluded: true, exclusionReason, excludedDocuments: user.documents?.map(({name}) => ({name})), documents: undefined, content }, { ...reply, excluded: true }] as ChatMessage[];
}
export function safeSessionSnapshot(sessions: ChatSession[], pendingIds: Set<string>) {
  return sessions.map(session => ({ ...session, messages: session.messages.filter(message => !pendingIds.has(message.id)) }));
}
