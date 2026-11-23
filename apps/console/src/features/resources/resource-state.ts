import { getLocale } from '../../lib/locale.ts';
export type Reading = number | null;
export interface CardReading {
  bdf: string; driver?: string; model?: string; link?: string; width?: string;
  smi_ok: boolean; smi_age: Reading; smi_error?: string; smi_sample_at?: string | null;
  power_state?: 'active' | 'suspended' | 'resuming' | 'suspending' | 'unknown';
  smi_interval?: number; smi_valid_for?: number; smi_manual?: boolean; smi_mode?: 'manual';
  driver_version?: string; firmware_version?: string; ipu_load?: Reading;
  core_util?: Reading[]; frequency_mhz?: Reading; power_w?: Reading;
  memory_total?: Reading; memory_used?: Reading; memory_free?: Reading;
  core_temp?: Reading; ddr_temp?: Reading;
}
export interface ResourceSample {
  timestamp: string; host: string; kernel: string; interval: number; cpu: Reading;
  cores: Reading[]; core_ids: number[]; frequencies: Reading[];
  ram_total: Reading; ram_available: Reading; swap_total: Reading; swap_free: Reading;
  disk_total: Reading; disk_used: Reading; disk_available: Reading;
  read_bps: Reading; write_bps: Reading; rx_bps: Reading; tx_bps: Reading; net_interfaces: string[];
  temperatures: { name: string; type: string; value: Reading }[]; loadavg: string[]; uptime: number;
  model_processes: number; model_rss: Reading; model_cpu: Reading;
  models: { name: string; backend: string; pid: number; port: string; context: string; rss: Reading; mtp: boolean }[];
  docker_count: number; docker_memory: Reading;
  accelerators: { houmo: CardReading[]; gpu: { name: string; busy: Reading; vram_used: Reading; vram_total: Reading }[]; npu: { name: string; frequency: Reading }[]; aipu_loaded: boolean };
}
export interface ResourcePoint { timestamp: string; cpu: Reading; ram_available: Reading; temperature: Reading; }
export interface ResourceEnvelope {
  status: 'live' | 'warming' | 'stale'; sample: ResourceSample | null; history: ResourcePoint[];
  age_seconds: Reading; error: string; sample_interval: number; smi_interval: number; idle_seconds: number;
}
export function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
export function acceleratorTelemetry(card: CardReading, hostAge: Reading, connected = true) {
  const age = finite(hostAge) && finite(card.smi_age) ? Math.max(0, hostAge) + Math.max(0, card.smi_age) : null;
  const hostLive = connected && finite(hostAge) && hostAge >= 0 && hostAge < 8;
  const sleeping = hostLive && card.power_state === 'suspended';
  const manual = hostLive && card.smi_manual && finite(age) && !card.smi_error;
  const fresh = hostLive && card.smi_ok && finite(age) && age < (card.smi_valid_for ?? 6);
  const mode = sleeping ? 'sleeping' : manual ? 'manual' : fresh ? (card.smi_interval ?? 2) > 2 ? 'idle' : 'live' : 'unavailable';
  return { age, mode, historical: sleeping || mode === 'idle' || mode === 'manual', canRead: sleeping || manual || fresh } as const;
}
export function reading(value: unknown, digits = 1, suffix = '') {
  return finite(value) ? `${value.toLocaleString(getLocale(), { maximumFractionDigits: digits, minimumFractionDigits: digits })}${suffix}` : 'N/A';
}
export function gib(value: unknown, digits = 2) { return finite(value) ? reading(value / 1024 ** 3, digits, ' GiB') : 'N/A'; }
export function rate(value: unknown) {
  if (!finite(value)) return 'N/A';
  const unit = value >= 1024 ** 2 ? 2 : value >= 1024 ? 1 : 0;
  return reading(value / 1024 ** unit, unit ? 1 : 0, ` ${['B/s', 'KiB/s', 'MiB/s'][unit]}`);
}
export function difference(total: Reading, available: Reading) { return finite(total) && finite(available) ? Math.max(0, total - available) : null; }
export function percent(part: Reading, total: Reading) { return finite(part) && finite(total) && total > 0 ? Math.max(0, Math.min(100, part / total * 100)) : null; }
export function sampleAge(envelope: ResourceEnvelope | null, receivedAt: number, now: number) {
  return envelope && finite(envelope.age_seconds) ? envelope.age_seconds + Math.max(0, now - receivedAt) / 1000 : null;
}
export function resourceStatus(envelope: ResourceEnvelope | null, age: Reading, error: string, paused: boolean, visible: boolean, maxAge = 4): 'paused' | 'hidden' | 'stale' | 'live' | 'warming' {
  if (paused) return 'paused';
  if (!visible) return 'hidden';
  if (error || envelope?.status === 'stale' || finite(age) && age > maxAge) return 'stale';
  return envelope?.status === 'live' && finite(age) ? 'live' : 'warming';
}
export const resourceSampleGapMs = 3500;
/** Focus the view on the latest continuous run, using device timestamps rather than browser time.
 * Keep null readings and the original envelope intact; a temporal break must not squeeze
 * current observations against an old segment on the same numeric time axis.
 */
export function resourceHistoryWindow(points: ResourcePoint[]) {
  let end = points.length;
  while (end > 0 && !finite(Date.parse(points[end - 1].timestamp))) end--;
  if (!end) return { points: [] as ResourcePoint[], omitted: points.length, interrupted: points.length > 0 };
  let start = end - 1;
  while (start > 0) {
    const time = Date.parse(points[start].timestamp), previous = Date.parse(points[start - 1].timestamp);
    if (!finite(previous) || time <= previous || time - previous > resourceSampleGapMs) break;
    start--;
  }
  const interrupted = start > 0 || end < points.length;
  const recent = points.slice(Math.max(start, end - 60), end);
  return { points: recent, omitted: points.length - recent.length, interrupted };
}

/** Broken or missing points and sampling gaps start a new segment; zero is a real value. */
export function resourceTrend(points: ResourcePoint[], key: 'cpu' | 'ram_available' | 'temperature', ceiling?: number) {
  const values = points.map(p => p[key]).filter(finite), max = ceiling || Math.max(...values, 1);
  let previousTime = -Infinity, latestTime = -Infinity, count = 0, ready = false;
  const path = points.map((point, index) => {
    const value = point[key], time = Date.parse(point.timestamp);
    if (!finite(value) || !finite(time) || time <= latestTime) { previousTime = -Infinity; return ''; }
    const connected = finite(previousTime) && time - previousTime <= resourceSampleGapMs;
    const command = connected ? 'L' : 'M';
    ready ||= connected; count++; previousTime = latestTime = time;
    return `${command}${(index / Math.max(1, points.length - 1) * 240).toFixed(1)},${(36 - Math.max(0, Math.min(1, value / max)) * 32).toFixed(1)}`;
  }).join(' ');
  return { path, count, ready };
}

export function trendPath(points: ResourcePoint[], key: 'cpu' | 'ram_available' | 'temperature', ceiling?: number) {
  return resourceTrend(points, key, ceiling).path;
}

/** Zero-based, peak-relative range with 20% headroom and four readable intervals. */
export function resourceAxis(values: Reading[], ceiling?: number) {
  const peak = values.reduce<number>((max, value) => finite(value) && value >= 0 ? Math.max(max, value) : max, 0);
  const targetStep = Math.max(1, peak * 1.2) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(targetStep));
  const step = ([1, 2, 2.5, 5, 10].find(value => value * magnitude >= targetStep) ?? 10) * magnitude;
  const niceUpper = Number((step * 4).toPrecision(12));
  // Keep physical bounds where available, without clipping an observed outlier.
  const upper = finite(ceiling) && ceiling > 0 ? Math.min(niceUpper, Math.max(ceiling, peak)) : niceUpper;
  const ticks = Array.from({ length: 5 }, (_, index) => Number((upper * index / 4).toPrecision(12)));
  return { upper, ticks };
}
