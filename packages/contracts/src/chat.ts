import type {DecisionEngine, DecisionEngineState} from './decision-engines.ts';
export type Mode = 'auto' | 'small' | 'tiny' | 'vision' | 'cpu' | 'standard' | 'large' | 'cloud';
export type Scope = 'local' | 'hybrid';
export type Content = string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];
export interface DocumentAttachment { id: string; name: string; bytes: number; characters: number; pages: number | null; sha256: string; }
export interface Health {
  decision_engines?:Record<DecisionEngine,DecisionEngineState>; decision_default?:DecisionEngine;
  version: string; workspace_id?: string; guard_ready: boolean; busy: boolean; benchmark: boolean;
  models: Record<Exclude<Mode, 'auto'>, { label: string; ready: boolean; vision?: boolean; cloud?: boolean }>;
  switch: { status: string; error?: string }; input_mode: string; image_safety?: string;
}
export interface Decision { decision_engine?:DecisionEngine; decision_engine_label?:string; classifier_used?:boolean; decision_error?:string; classifier_result?:unknown; preparation_ms?:number; recommended?: Mode; difficulty?: string; reason?: string; source?: string; modality?: string; laya?: unknown; decision_http_ms?: number; }
export interface Stage { stage: string; created?: string; elapsed_ms?: number; gateway_request_id?: string; }
export interface RequestError { code: string; error: string; reason_code?: string; category?: string; upstream_error_code?: string; review_source?: 'document' | 'image' | 'text'; http_status?: number; request_id?: string; gateway_request_id?: string; failure_stage?: string; }
export interface ReplyMeta {
  actual_upstream_model?: string; fallback?: string | null; finish_reason?: string;
  decision_engine?:DecisionEngine; request_id?: string; gateway_request_id?: string; mode?: Mode; scope?: Scope; selected?: Mode; model?: string;
  decision?: Decision; decision_ms?: number; ttft_ms?: number; elapsed_ms?: number; stages?: Stage[];
  error?: RequestError; monitor?: { reused?: boolean }; output_policy?: string; context_saved?: boolean;
}
export interface ChatMessage { id: string; role: 'user' | 'assistant'; content: Content; documents?: DocumentAttachment[]; excluded?: boolean; excludedDocuments?: Pick<DocumentAttachment, 'name'>[]; exclusionReason?: 'protection' | 'cancelled' | 'incomplete'; meta?: ReplyMeta; runId?: string; snapshot?: import('./workspace.ts').TurnSnapshot; }
export interface ChatSession { id: string; title: string; messages: ChatMessage[]; project?: string | null; boundProject?: string | null; draftOnly?: boolean; }
export type StreamEvent = { event: 'accepted' | 'stage' | 'decision' | 'token' | 'done' | 'error'; text?: string; answer?: string; decision?: Decision; stage?: string; created?: string } & ReplyMeta & Partial<RequestError>;
export interface ModelTest {
  id: string; sourceRow: number; model: string; family: string; backend: string; thinking: string; precision: string; context: number | null;
  date: string; status: string; batch: string; textTps: number | null; textTtft: number | null; visionTtft: number | null; rssGiB: number | null;
  textN?: number; visionN?: number; recordCount: number; notes: string; quality: string; report: string; service: string; chatUrl?: string; rssMethod?: string;
}
export interface ModelRecord {
  id: string; testId: string; model: string; backend: string; thinking: string; batch: string; kind: string; caseId: string; repeat: number;
  ttft: number | null; elapsed: number | null; tps: number | null; answer: string; prompt: string; review: string; judgement: string;
  expected?: unknown; finish?: string; image?: string;
}
export interface Pair { model: string; cpuId: string; houmoId: string; decodeSpeedup: number; cardDdrGiB?: number; cardPowerW?: number; note: string; }
/** Evidence payloads retain upstream schemas; feature adapters validate the fields they display. */
export type Evidence = Record<string, any>;
export interface DashboardData {
  schemaVersion: number; updatedAt: string; source: { name: string; sha256: string; url: string };
  device: Evidence; tests: ModelTest[]; records: ModelRecord[]; pairs: Pair[]; protocol: Evidence[];
  decisionTests?: Evidence[]; routingTests?: Evidence[]; controlledTests?: Evidence[];
  workspaceAcceptance?: Evidence;
  counts: { models: number; measuredBatches: number; records: number; pairs: number }; caseNames?: Record<string, string>;
}
