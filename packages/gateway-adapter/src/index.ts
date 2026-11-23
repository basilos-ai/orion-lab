import type { HookStage } from '@orion/contracts';
export class BridgeClient {
  private origin: string; private token: string;
  constructor(origin: string, token: string) {
    this.origin = origin; this.token = token;
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('loopback_bridge_required');
  }
  async call(path: string, body: unknown, signal?: AbortSignal): Promise<any> {
    const response = await fetch(this.origin + path, { method: 'POST', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.any([AbortSignal.timeout(190000), ...(signal ? [signal] : [])]) });
    const result = await response.json() as any;
    if (!response.ok) throw new Error(typeof result.code === 'string' ? result.code : 'bridge_unavailable');
    return result;
  }
  async check(run: string, stage: HookStage, content: unknown, signal?: AbortSignal) {
    const result = await this.call('/hooks/check', { run, stage, content }, signal);
    if (result.verdict !== 'allow') throw new Error('policy_blocked');
    return result;
  }
}
// Native source attribution is never rewritten to Codex or Claude Code.
export function nativeHookSource(supported: readonly string[]): 'pi' {
  if (!supported.includes('pi')) throw new Error('native_pi_source_unsupported');
  return 'pi';
}
