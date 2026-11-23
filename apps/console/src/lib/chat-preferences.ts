import type { Mode, Scope } from './types';

export const chatPreferencesKey = 'orion-chat-preferences-v1';
export interface ChatPreferences { mode: Mode; scope: Scope }
const modes: readonly Mode[] = ['auto', 'small', 'tiny', 'vision', 'cpu', 'standard', 'large', 'cloud'];

/** Restore only settings, never draft contents or an implicit permission upgrade. */
export function readChatPreferences(value: unknown): ChatPreferences {
  if (value == null) return { mode: 'auto', scope: 'hybrid' };
  const saved = typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const scope: Scope = saved.scope === 'hybrid' ? 'hybrid' : 'local';
  const candidate = modes.includes(saved.mode as Mode) ? saved.mode as Mode : 'auto';
  return { mode: candidate === 'cloud' && scope === 'local' ? 'auto' : candidate, scope };
}

export function loadChatPreferences(read = () => localStorage.getItem(chatPreferencesKey)): ChatPreferences {
  try {
    const raw = read();
    return raw === null ? readChatPreferences(null) : readChatPreferences(JSON.parse(raw) ?? {});
  } catch {
    return readChatPreferences({});
  }
}

interface DraftContent { text: string; images: readonly unknown[]; files: readonly string[]; documents?: readonly unknown[] }
function hasContent(draft: DraftContent) { return Boolean(draft.text.trim() || draft.images.length || draft.files.length || draft.documents?.length); }

/** The active editor supersedes its old map snapshot, including after clearing it. */
export function hasUnsentDrafts(activeId: string, active: DraftContent, pending: ReadonlyMap<string, DraftContent>) {
  return hasContent(active) || [...pending].some(([id, draft]) => id !== activeId && hasContent(draft));
}
