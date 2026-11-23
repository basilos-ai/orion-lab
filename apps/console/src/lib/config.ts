import { getLocale } from './locale.ts';
export interface PublicConfig {
  chatBase?: string; dashboardBase?: string; gatewayBase?: string; layaBase?: string;
  deviceName?: string; deviceSummary?: string; demo?: boolean;
}
export const config: PublicConfig = typeof __O6N_CONFIG__ === 'undefined' ? {} : __O6N_CONFIG__;
export function serviceUrl(service: 'chat' | 'dashboard' | 'gateway' | 'laya', options: PublicConfig = config, address: Pick<Location, 'hostname' | 'protocol' | 'href'> = location) {
  const ports = { chat: 17790, dashboard: 17780, gateway: 13000, laya: 17785 };
  const host = address.hostname.includes(':') ? `[${address.hostname}]` : address.hostname;
  const target = new URL(options[`${service}Base`] || `${address.protocol}//${host}:${ports[service]}/`, address.href);
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Unsupported service URL');
  return target;
}
export function readTheme(value: string | null): 'light' | 'dark' | 'system' {
  return value === 'light' || value === 'dark' ? value : 'system';
}
export function storageRead<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}
export function storageWrite(key: string, value: unknown): boolean {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
export function number(value: unknown, digits = 2): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString(getLocale(), { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '—';
}
export function milliseconds(value?: number | null) {
  return value == null ? '—' : value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
}
export function pageWindow(count: number, page = 1, size = 10) {
  const pages = Math.max(1, Math.ceil(count / size)); const current = Math.max(1, Math.min(pages, page));
  return { page: current, pages, from: (current - 1) * size, to: Math.min(current * size, count) };
}
export function safeFilename(value: string) { return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 80) || 'conversation'; }
export function downloadFile(filename: string, content: string, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement('a');
  link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function csvCell(value: unknown) {
  let text = value == null ? '' : String(value); if (typeof value === 'string' && /^[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
