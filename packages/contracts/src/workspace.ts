import type {DecisionEngine} from './decision-engines.ts';
import type { Mode, ReplyMeta } from './chat.ts';
export type WorkMode = 'agent';
/** `ask` is accepted only for historical snapshots and older clients. */
export interface TurnSnapshot { mode: WorkMode | 'ask'; execution?: 'answer' | 'tools'; access?: 'read' | 'edit'; model: Mode; scope?: 'local'|'hybrid'; decisionEngine?:DecisionEngine; project: string | null; files: string[] }
export interface CompletedTurn { id: string; engine: 'chat' | 'pi'; prompt: string; answer: string; created: string; runId?: string; snapshot: TurnSnapshot; feedback?: ReplyMeta }
export interface ConversationView { id: string; project: string | null; turns: CompletedTurn[]; runIds: string[]; created: string }
export function conversationId(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:[a-f0-9]{32}|[a-f0-9-]{36})$/.test(value)) throw new Error('invalid_conversation');
  return value;
}
/** Last completed turns only. No tool logs, pending patches or failed partial answers. */
export function contextMessages(turns: CompletedTurn[], budget = 3000): { role: 'user' | 'assistant'; content: string }[] {
  const selected: CompletedTurn[] = []; let used = 0;
  for (const t of turns.slice(-6).reverse()) {
    const size = t.prompt.length + t.answer.length;
    if (used + size > budget) break;
    selected.unshift(t); used += size;
  }
  return selected.flatMap(t => [{ role: 'user' as const, content: t.prompt }, { role: 'assistant' as const, content: t.answer }]);
}
