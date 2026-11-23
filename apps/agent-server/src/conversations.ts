import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { conversationId, contextMessages, type CompletedTurn, type ConversationView } from '@orion/contracts';
import { safeText } from '@orion/tool-runner';

type Stored = ConversationView & { owner: string; legacyOwner?: string };
export class ConversationStore {
  private root: string;
  constructor(root: string) { this.root=root; mkdirSync(root, { recursive: true, mode: 0o700 }); }
  private file(id: string) { return path.join(this.root, conversationId(id) + '.json'); }
  get(id: string, owner: string, legacy?: string): Stored {
    const item: Stored = JSON.parse(readFileSync(this.file(id), 'utf8'));
    // Legacy conversations keep their old principal. A new browser must not claim them.
    if (item.owner !== owner && !(legacy && /^[a-f0-9]{64}$/.test(legacy) && item.owner === legacy)) throw new Error('conversation_denied'); return item;
  }
  list(owner: string, legacy?: string) {
    return readdirSync(this.root).filter(f => /^[a-f0-9-]{32,36}\.json$/.test(f)).slice(-2000).flatMap(file => {
      try { const item = this.get(file.slice(0,-5), owner, legacy); return [{ id: item.id, project: item.project, title: (item as any).title || item.turns[0]?.prompt.slice(0,32) || '新对话', created: item.created }]; } catch { return []; }
    });
  }
  ensure(id: string, owner: string, legacy?: string) {
    if (!/^[a-f0-9]{64}$/.test(owner)) throw new Error('owner_required');
    if (existsSync(this.file(id))) return this.get(id, owner, legacy);
    const item: Stored = { id, owner, ...(legacy && /^[a-f0-9]{64}$/.test(legacy) ? {legacyOwner:legacy} : {}), project: null, turns: [], runIds: [], created: new Date().toISOString() }; this.save(item); return item;
  }
  save(item: Stored) {
    const file = this.file(item.id), temp = file + '.tmp';
    writeFileSync(temp, JSON.stringify(item), { mode: 0o600 }); renameSync(temp, file);
  }
  bindProject(item: Stored, project: string) {
    if (item.project && item.project !== project) throw new Error('project_changed_new_conversation_required');
    item.project = project; this.save(item);
  }
  complete(id: string, owner: string, turn: CompletedTurn, legacy?: string) {
    const item = this.get(id, owner, legacy); conversationId(turn.id);
    if (item.turns.some(t => t.id === turn.id)) return;
    if (!turn.prompt || turn.prompt.length > 16000 || turn.answer.length > 40000) throw new Error('turn_budget');
    safeText(turn.prompt); safeText(turn.answer);
    if(turn.feedback!==undefined){const encoded=JSON.stringify(turn.feedback);if(encoded.length>16000||!turn.feedback||typeof turn.feedback!=='object'||Array.isArray(turn.feedback))throw new Error('invalid_feedback');safeText(encoded);}
    item.turns.push(turn); item.turns = item.turns.slice(-100); this.save(item);
  }
  context(item: ConversationView) { return contextMessages(item.turns); }
}
