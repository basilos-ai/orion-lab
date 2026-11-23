import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {migrateSessions,attachRun,diffLines,restoreConversation} from '../apps/console/src/lib/workspace.ts';
import {contextMessages,conversationId} from '../packages/contracts/src/workspace.ts';
import {ConversationStore} from '../apps/agent-server/src/conversations.ts';

test('Workspace migration is idempotent and never mutates or overwrites legacy history',()=>{
 const legacy=[{id:'old',title:'原对话',messages:[{id:'u',role:'user',content:'保留'}]}],before=JSON.stringify(legacy);
 const next=migrateSessions([{id:'new',title:'新',messages:[]}],legacy);
 assert.deepEqual(migrateSessions(next,legacy),next);assert.equal(JSON.stringify(legacy),before);
 assert.equal(migrateSessions(null,null).length,0);
});
test('Polling a Pi run updates one pair without moving later chat; failed text is excluded',()=>{
 const run={id:'r',conversationId:'c',project:'demo',model:'auto',scope:'hybrid',access:'read',phase:'completed',events:[{type:'prompt',data:{text:'原任务'}},{type:'answer',data:{text:'完成'}}]};
 let sessions=attachRun([{id:'c',title:'对话',messages:[{id:'first',role:'user',content:'前文'}]}],run);
 assert.equal(sessions[0].messages.find(m=>m.id==='r-user').snapshot.scope,'hybrid','Auto history must retain actual authorization scope');
 sessions[0].messages.push({id:'later',role:'user',content:'后文'});
 sessions=attachRun(sessions,run);assert.deepEqual(sessions[0].messages.map(m=>m.id),['first','r-user','r-reply','later']);
 sessions=attachRun(sessions,{...run,phase:'failed'});assert(sessions[0].messages.find(m=>m.id==='r-user').excluded);assert(!sessions[0].messages.find(m=>m.id==='r-user').content.includes('原任务'));
});
test('Context stays bounded, chronological and uses only the completed-turn store',()=>{
 const turns=[1,2,3].map(i=>({id:String(i),prompt:'问题'+i,answer:'回答'+i}));
 assert.deepEqual(contextMessages(turns,12).map(m=>m.content),['问题2','回答2','问题3','回答3']);
 assert.equal(contextMessages(turns,1).length,0);assert.throws(()=>conversationId('../escape'));
});
test('Conversation storage checks device ownership, exact project and idempotent completion',()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'orion-conversations-'));try{
 const store=new ConversationStore(root),id='a'.repeat(32),owner='b'.repeat(64),turn={id:'c'.repeat(32),engine:'chat',prompt:'名字是蓝鲸',answer:'已记住',snapshot:{mode:'ask',model:'small',project:null,files:[]},created:new Date().toISOString()};
 store.ensure(id,owner);assert.throws(()=>store.ensure(id,'d'.repeat(64)),/denied/);
 store.complete(id,owner,turn);store.complete(id,owner,turn);assert.equal(store.get(id,owner).turns.length,1);
 const item=store.get(id,owner);store.bindProject(item,'demo');assert.throws(()=>store.bindProject(item,'other'),/new_conversation/);
 assert.equal(new ConversationStore(root).get(id,owner).turns[0].answer,'已记住');
 assert.throws(()=>store.complete(id,owner,{...turn,id:'e'.repeat(32),prompt:'sk-'+'x'.repeat(24)}),/sensitive/);
 assert(!readFileSync(path.join(root,id+'.json'),'utf8').includes('sk-'));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('Legacy conversation compatibility never lets the first new browser claim old history',()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'orion-legacy-'));try{
  const store=new ConversationStore(root),id='a'.repeat(32),legacy='b'.repeat(64),first='c'.repeat(64),second='d'.repeat(64);store.ensure(id,legacy);
  const original=readFileSync(path.join(root,id+'.json'),'utf8');assert.equal(store.list(first,legacy).length,1);assert.equal(store.get(id,second,legacy).owner,legacy);assert.equal(readFileSync(path.join(root,id+'.json'),'utf8'),original);
  store.complete(id,first,{id:'e'.repeat(32),engine:'chat',prompt:'旧会话接续',answer:'保留',snapshot:{mode:'ask',model:'auto',project:null,files:[]},created:new Date().toISOString()},legacy);
  assert.equal(store.get(id,second,legacy).turns.length,1);assert.equal(store.get(id,first,legacy).owner,legacy);
  const fresh='f'.repeat(32);store.ensure(fresh,first,legacy);assert.throws(()=>store.get(fresh,second,legacy),/denied/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('Diff rows retain exact old/new line numbers and unchanged surrounding lines',()=>{
 assert.deepEqual(diffLines('one\ntwo\nthree','one\nchanged\nextra\nthree').map(l=>[l.kind,l.old,l.next,l.text]),[['same',1,1,'one'],['remove',2,0,'two'],['add',0,2,'changed'],['add',0,3,'extra'],['same',3,4,'three']]);
 assert.deepEqual(diffLines('','new file'),[{kind:'add',old:0,next:1,text:'new file'}]);assert.deepEqual(diffLines('',''),[]);
});

test('History recovery merges completed chat and Pi turns with rejected rows, preserving local full history',()=>{
 const snapshot={mode:'ask',model:'auto',project:null,files:[]},id='a'.repeat(32);
 const run={id:'run',conversationId:id,project:'demo',model:'auto',created:'2026-10-20T01:00:01Z',phase:'completed',events:[]};
 const failed={...run,id:'rejected',created:'2026-10-20T01:00:02Z',phase:'blocked'};
 const stub=attachRun(attachRun([],run),failed);
 const server={id,project:'demo',created:'2026-10-20T01:00:00Z',runIds:['run','rejected'],turns:[{id:'first',prompt:'原问答',answer:'原回答',created:'2026-10-20T09:00:00+08:00',snapshot},{id:'second',runId:'run',prompt:'读取项目',answer:'历史项目回答',created:run.created,snapshot:{...snapshot,project:'demo'}}]};
 const restored=restoreConversation(stub,server,{run,rejected:failed});
 assert.deepEqual(restored[0].messages.map(m=>m.id),['first','first-reply','run-user','run-reply','rejected-user','rejected-reply']);assert.equal(restored[0].title,'原问答');assert.equal(restored[0].messages[3].content,'历史项目回答');assert(restored[0].messages[4].excluded);
 assert.deepEqual(restoreConversation(restored,server,{run}),restored);
 const renamed=stub.map(s=>({...s,title:'我的自定义标题'}));assert.equal(restoreConversation(renamed,server,{run,rejected:failed})[0].title,'我的自定义标题');
});
