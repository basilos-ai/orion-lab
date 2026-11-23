/** Structural UI types consumed by PromptInput; no model SDK runtime. */
export type ChatStatus = 'submitted' | 'streaming' | 'ready' | 'error';
export interface FileUIPart { type: 'file'; mediaType: string; filename?: string; url: string }
export interface SourceDocumentUIPart { type: 'source-document'; sourceId: string; mediaType: string; title: string; filename?: string }
