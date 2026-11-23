import type { AgentModel, AgentScope } from '@orion/contracts';
/** Validate the server admission; auto is decided by local Laya, once per run. */
export function agentRoute(model: AgentModel, scope: AgentScope = 'local', admitted?: string): 'standard' | 'cloud' {
  if (!['auto', 'standard', 'cloud'].includes(model)) throw new Error('invalid_model');
  if (!['local', 'hybrid'].includes(scope)) throw new Error('invalid_scope');
  const selected = admitted ?? (model === 'cloud' ? 'cloud' : 'standard');
  if (!['standard', 'cloud'].includes(selected)) throw new Error('route_mismatch');
  if (selected === 'cloud' && scope !== 'hybrid') throw new Error('cloud_scope_required');
  if (model !== 'auto' && selected !== (model === 'cloud' ? 'cloud' : 'standard')) throw new Error('route_mismatch');
  return selected as 'standard' | 'cloud';
}
