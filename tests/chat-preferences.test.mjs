import test from 'node:test';
import assert from 'node:assert/strict';
import {readChatPreferences, loadChatPreferences, hasUnsentDrafts} from '../apps/console/src/lib/chat-preferences.ts';

test('Chat preferences retain closed model/scope choices without silently authorizing cloud',()=>{
  assert.deepEqual(readChatPreferences(null),{mode:'auto',scope:'hybrid'});
  for(const mode of ['auto','small','tiny','vision','cpu','standard','large','cloud'])for(const scope of ['local','hybrid']){
    assert.deepEqual(readChatPreferences({mode,scope}),{mode:mode==='cloud'&&scope==='local'?'auto':mode,scope});
  }
  assert.deepEqual(readChatPreferences({mode:'arbitrary',scope:'local'}),{mode:'auto',scope:'local'});
  for(const bad of [[],false,'hybrid',{mode:'cloud'},{mode:'cloud',scope:'bad'}])assert.deepEqual(readChatPreferences(bad),{mode:'auto',scope:'local'});
  assert.deepEqual(loadChatPreferences(()=>null),{mode:'auto',scope:'hybrid'});
  for(const raw of ['{','null','"bad"'])assert.deepEqual(loadChatPreferences(()=>raw),{mode:'auto',scope:'local'});
  assert.deepEqual(loadChatPreferences(()=>{throw new Error('storage denied');}),{mode:'auto',scope:'local'});
});

test('Unload protection covers inactive text, images and files and ignores stale active snapshots',()=>{
  const empty={text:'',images:[],files:[]}, text={...empty,text:'not sent'};
  assert.equal(hasUnsentDrafts('a',empty,new Map([['b',text]])),true);
  assert.equal(hasUnsentDrafts('a',empty,new Map([['a',text]])),false);
  assert.equal(hasUnsentDrafts('a',text,new Map()),true);
  for(const content of [{...empty,images:['image']},{...empty,files:['README.md']}]){
    assert.equal(hasUnsentDrafts('a',empty,new Map([['b',content]])),true);
  }
  assert.equal(hasUnsentDrafts('a',empty,new Map([['b',{...empty,text:'  '}]])),false);
});
