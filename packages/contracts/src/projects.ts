/** Public project identifiers never contain a server filesystem path. */
export interface ProjectSummary {
  id: string;
  name: string;
  description?: string;
  source?: 'empty' | 'import' | 'legacy';
  status?: 'active' | 'archived';
  created?: string;
  updated?: string;
  location?: 'o6n';
  revision?: string;
}
export interface ProjectEntry { path: string; kind: 'file' | 'directory'; bytes: number }
export interface ProjectFiles { entries: ProjectEntry[]; files: string[]; limits: { files: number; bytes: number; fileBytes: number; depth: number }; truncated: boolean }
export interface ImportPreview { id: string; files: { path: string; bytes: number }[]; skipped: { path: string; reason: string }[]; bytes: number; expires: string }
export const projectLimits = { files: 200, bytes: 1024 * 1024, fileBytes: 32768, depth: 5, entries: 400 } as const;
export function projectId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(value)) throw new Error('invalid_project');
  return value;
}
