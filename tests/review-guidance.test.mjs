import {test} from 'node:test';
import assert from 'node:assert/strict';
import {documentReviewGuidance,documentRiskMessages} from '../apps/console/src/lib/review-guidance.ts';
import {setLocale} from '../apps/console/src/lib/locale.ts';
import {englishMessages} from '../apps/console/src/lib/messages.ts';

test('Document block guidance identifies fixed risks in both languages without echoing supplied explanations',()=>{
 const expected={document_credentials:['密码或密钥','Passwords or credentials'],document_privacy:['个人隐私','Personal information'],document_confidential:['商业机密','Confidential business information'],document_sexual:['成人色情内容','Explicit sexual content'],document_violence:['暴力或威胁','Violence or threats'],document_illicit:['违法或危险行为指导','Illegal or dangerous instructions'],document_injection:['审核指令注入','Review instruction injection']};
 try{for(const [reason,labels] of Object.entries(expected))for(const [index,locale] of ['zh-CN','en-US'].entries()){
  setLocale(locale);const result=documentReviewGuidance({code:'input_blocked',error:'do not echo matched sensitive material',reason_code:reason,review_source:'document'});
  assert(result.title.includes(labels[index]));assert(result.reason);assert(result.advice);assert(result.stopped);assert(!JSON.stringify(result).includes('do not echo'));
  if(locale==='en-US')assert(!/[\p{Script=Han}]/u.test(JSON.stringify(result)));
 }}finally{setLocale('zh-CN');}
 for(const message of documentRiskMessages)assert(Object.hasOwn(englishMessages,message),message);
});
test('Document faults, uncertain verdicts and legacy blocks remain distinct and do not invent a category',()=>{
 try{setLocale('en-US');
  const hint=(reason,extra={})=>documentReviewGuidance({code:'review_unavailable',review_source:'document',error:'raw',reason_code:reason,...extra});
  assert.match(hint('document_uncertain').reason,/could not determine/);assert.match(hint('document_review_timeout').reason,/timed out/);assert.match(hint('document_review_invalid').reason,/unavailable/);
  assert.match(hint('document_sensitive',{code:'input_blocked'}).title,/Unspecified risk/);
  assert.match(hint('__proto__',{code:'input_blocked',category:'constructor'}).title,/Unspecified risk/);
  assert.match(hint('api_key',{code:'input_blocked'}).title,/credentials/);
  assert.equal(documentReviewGuidance({code:'input_blocked',error:'text only',reason_code:'api_key'}),null);
  assert.equal(documentReviewGuidance({code:'request_failed',error:'connection',review_source:'document'}),null);
 }finally{setLocale('zh-CN');}
});
