import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chatTurnFeedback,agentTurnFeedback} from '../apps/console/src/lib/turn-feedback.ts';
import {restoreConversation} from '../apps/console/src/lib/workspace.ts';

test('Turn feedback separates a selected model from execution and never marks missing checks as passed',()=>{
 const selected={selected:'small',model:'Qwen3.5-4B',decision:{reason:'短句提取',source:'rule',classifier_used:false}};
 assert.match(chatTurnFeedback(selected).model,/尚无执行回执/);assert.equal(chatTurnFeedback(selected).source,'规则识别');assert.equal(chatTurnFeedback(selected).input,'结果未记录');
 const blocked=chatTurnFeedback({...selected,error:{code:'input_blocked',error:'blocked'}});assert.equal(blocked.model,'未调用回答模型');assert.equal(blocked.input,'已拦截');
 const actual=chatTurnFeedback({...selected,actual_upstream_model:'physical-4b',stages:[{stage:'input_passed'},{stage:'generating'}],output_policy:'stream_no_output_review'});assert.equal(actual.model,'Qwen3.5-4B');assert.equal(actual.input,'检查通过');assert.match(actual.output,/未启用输出审核/);
 assert.match(chatTurnFeedback({}).output,/未记录/);
});
test('Project feedback distinguishes output blocking from input blocking and semantic coverage',()=>{
 const event=(type,data)=>({seq:1,type,data,at:''}),run={phase:'cancelled',selected:'standard',events:[event('hook',{stage:'UserPromptSubmit',verdict:'allow'}),event('answer_delta',{text:'安全片段'}),event('protection',{direction:'output',verdict:'block'})]};
 const result=agentTurnFeedback(run);assert.equal(result.input,'检查通过');assert.equal(result.output,'项目敏感输出已拦截');assert.equal(result.model,'Qwen3.5-9B');assert.equal(result.blocked,true);
 assert.equal(agentTurnFeedback({...run,events:[event('protection',{direction:'input',verdict:'unavailable'})]}).input,'审核未完成，已停止');
 assert.equal(agentTurnFeedback({...run,events:[event('protection',{direction:'tool_output',verdict:'block',scope:'project'})]}).output,'工具结果审核已拦截');
 assert.equal(agentTurnFeedback({...run,events:[event('protection',{direction:'tool_input',verdict:'block'})]}).tool,'工具调用已拦截');
});
test('Restoring server-completed chat retains actual-model and guard receipts without inventing old metadata',()=>{
 const item={id:'a'.repeat(32),project:null,turns:[{id:'b'.repeat(32),created:'2026-10-22',prompt:'合成问题',answer:'合成回答',snapshot:{mode:'agent',model:'auto',project:null,files:[]},feedback:{actual_upstream_model:'physical-9b',decision:{reason:'多步计算'},output_policy:'stream_no_output_review'}}],runIds:[],created:'2026-10-22'};
 const restored=restoreConversation([],item,{});assert.equal(restored[0].messages[1].meta.actual_upstream_model,'physical-9b');assert.equal(restored[0].messages[1].meta.decision.reason,'多步计算');
 const old=restoreConversation([],{...item,turns:[{...item.turns[0],feedback:undefined}]},{});assert.equal(old[0].messages[1].meta,undefined);
});
