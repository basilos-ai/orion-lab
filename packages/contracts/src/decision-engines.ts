/** A decision engine classifies requests; it is separate from the answer model. */
export const decisionEngineNames = {
  laya: 'Laya',
  'qwen35-2b-houmo': 'Qwen3.5-2B · 后摩',
  'qwen35-4b-houmo': 'Qwen3.5-4B · 后摩',
} as const;
export type DecisionEngine = keyof typeof decisionEngineNames;
export interface DecisionEngineState { label:string; backend:'cpu'|'houmo'; available:boolean; state:'ready'|'loading'|'on_demand'|'unavailable' }
export function parseDecisionEngine(value:unknown):DecisionEngine {
  if(value===undefined)return 'laya';
  if(typeof value!=='string'||!Object.hasOwn(decisionEngineNames,value))throw new Error('invalid_decision_engine');
  return value as DecisionEngine;
}
