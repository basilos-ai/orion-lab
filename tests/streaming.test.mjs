import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AnswerStream,outputProtectionSelfTest} from '../packages/agent-runtime/src/answer-stream.ts';
import {answerSegments} from '../packages/contracts/src/agent.ts';
test('Output self-test checks both allow and split-credential blocking without exposing candidate text',()=>{
 const result=outputProtectionSelfTest();assert.equal(result.passed,true);assert.equal(result.safe_passed,true);assert.equal(result.blocked,true);assert.equal(result.sensitive_visible,false);assert.equal(result.model_called,false);assert.equal(result.semantic_review,false);assert.equal(result.scope,'project_output');assert(!JSON.stringify(result).includes('ORION_DEMO_NOT_A_REAL_CREDENTIAL'));
});

test('Streaming protects split credentials before exposure and flushes only validated text',()=>{
 const b=new AnswerStream();const text='普通中文回答，用于验证真正的增量显示。'.repeat(10);let out='';
 for(const ch of text)out+=b.append(ch);assert(out.length>0&&out.length<text.length);out+=b.finish(text);assert.equal(out,text);
 for(let split=0;split<28;split++){
  const c=new AnswerStream();let visible=c.append('正常回答。'.repeat(12));const key='sk-'+'a'.repeat(24);
  assert.throws(()=>{visible+=c.append(key.slice(0,split));visible+=c.append(key.slice(split));},/sensitive/);assert(!visible.includes('sk-'));
 }
 assert.throws(()=>new AnswerStream().finish('password=notpublic'),/sensitive/);
});
test('Canonical answers replace replayed deltas while legacy and interrupted text remain distinct',()=>{
 const e=(seq,type,data)=>({seq,type,data,at:''});
 const rows=[e(1,'answer_delta',{message:1,text:'部分'}),e(2,'answer_delta',{message:1,text:'回答'}),e(2,'answer_delta',{message:1,text:'回答'}),e(3,'answer',{message:1,text:'部分回答'}),e(4,'answer_delta',{message:1,text:'不可重复'}),e(5,'answer',{text:'旧版回答'}),e(6,'answer_delta',{message:2,text:'中断片段'})];
 assert.deepEqual(answerSegments(rows).map(p=>[p.text,p.complete]),[['部分回答',true],['旧版回答',true],['中断片段',false]]);
});
