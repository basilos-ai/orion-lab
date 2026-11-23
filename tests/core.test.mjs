import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceUrl, csvCell, pageWindow, safeFilename, readTheme, number } from '../apps/console/src/lib/config.ts';
import { splitEvents, consumeEvents, modelHistory, excludedTurn, safeSessionSnapshot, requestError } from '../apps/console/src/lib/stream.ts';

test('service addresses follow the deployment host and allow explicit origins', () => {
  const address = { protocol: 'http:', hostname: 'example.local', href: 'http://example.local:17780/' };
  assert.equal(serviceUrl('chat', {}, address).href, 'http://example.local:17790/');
  assert.equal(serviceUrl('dashboard', { dashboardBase: '/bench/' }, address).href, 'http://example.local:17780/bench/');
  assert.throws(() => serviceUrl('chat', { chatBase: 'javascript:alert(1)' }, address));
  assert.equal(serviceUrl('chat', {}, { ...address, hostname: '::1' }).hostname, '[::1]');
});
test('stream decoder preserves split JSON, unicode and the final line', () => {
  const first = splitEvents('', '{"event":"token","text":"中');
  assert.deepEqual(first.events, []);
  const second = splitEvents(first.rest, '文"}\n{"event":"done"}', true);
  assert.deepEqual(second.events, [{ event: 'token', text: '中文' }, { event: 'done' }]);
  assert.equal(second.rest, '');
});
test('real ReadableStream event consumption handles utf8 byte boundaries', async () => {
  const bytes = new TextEncoder().encode('{"event":"token","text":"中文"}\n{"event":"done"}');
  const body = new ReadableStream({ start(controller) { for (let index = 0; index < bytes.length; index++) controller.enqueue(bytes.slice(index, index + 1)); controller.close(); } });
  const result = []; await consumeEvents(new Response(body), item => result.push(item));
  assert.equal(result[0].text, '中文'); assert.equal(result[1].event, 'done');
});
test('HTTP errors and malformed events remain failures', async () => {
  await assert.rejects(() => consumeEvents(new Response('{"error":"session_required"}', { status: 401 }), () => {}), /session_required/);
  assert.throws(() => splitEvents('', '{invalid}\n'), SyntaxError);
});
test('blocked turn is redacted and excluded from the next model history', () => {
  const user = { id: 'u', role: 'user', content: 'synthetic-sensitive-input' };
  const reply = { id: 'a', role: 'assistant', content: '', meta: { error: { code: 'input_blocked' } } };
  const rejected = excludedTurn(user, reply);
  assert.equal(JSON.stringify(rejected).includes('synthetic-sensitive-input'), false);
  assert.deepEqual(modelHistory([...rejected, { id: 'next', role: 'user', content: '计算2+2' }]), [{ role: 'user', content: '计算2+2' }]);
});

test('HTTP failures retain status, service code and correlation IDs instead of becoming connection failures', async () => {
  for (const [status,body,code] of [[429,{code:'device_busy',error:'busy'},'device_busy'],[503,{error:{code:'model_unavailable',message:'warming up',request_id:'req-fixture'}},'model_unavailable'],[401,{error:'session_required'},'session_required'],[504,null,'request_timeout']]) {
    try { await consumeEvents(new Response(JSON.stringify(body),{status,headers:{'X-Request-ID':'http-fixture'}}),()=>{});assert.fail('must fail'); }
    catch(error) { const failure=requestError(error);assert.equal(failure.code,code);assert.equal(failure.http_status,status);assert.equal(failure.request_id,status===503?'req-fixture':'http-fixture'); }
  }
  assert.equal(requestError(new TypeError('Failed to fetch')).code,'connection_error');
  assert.equal(requestError(new Error('unknown failure')).code,'request_failed');
});

test('Invalid and interrupted streams are distinct, and terminal receipts survive trailing transport garbage', async () => {
  for (const event of [{event:'error',code:'input_blocked'},{event:'done',answer:'ok'}]) {
    const received=[];await consumeEvents(new Response(JSON.stringify(event)+'\n{broken}\n'),item=>received.push(item));assert.deepEqual(received,[event]);
  }
  await assert.rejects(()=>consumeEvents(new Response('{broken}\n'),()=>{}),error=>requestError(error).code==='stream_protocol_error');
  const interrupted=new ReadableStream({start(controller){controller.error(new TypeError('terminated'));}});
  await assert.rejects(()=>consumeEvents(new Response(interrupted),()=>{}),error=>requestError(error).code==='stream_interrupted');
  const cancelled=new ReadableStream({start(controller){controller.error(new DOMException('stopped','AbortError'));}});
  await assert.rejects(()=>consumeEvents(new Response(cancelled),()=>{}),error=>requestError(error).code==='cancelled');
});

test('Rejected document metadata keeps names only and remains excluded after storage roundtrip', () => {
  const user={id:'u',role:'user',content:'synthetic-document-prompt',documents:[{id:'private-id',name:'中文材料.docx',sha256:'private-hash',characters:20,bytes:42,pages:null}]};
  for(const [code,reason] of [['input_blocked','protection'],['review_unavailable','protection'],['connection_error','incomplete'],['cancelled','cancelled']]) {
    const pair=excludedTurn(user,{id:'a',role:'assistant',content:'',meta:{error:{code,error:'fixture'}}});
    const saved=JSON.parse(JSON.stringify(safeSessionSnapshot([{id:'s',title:'fixture',messages:pair}],new Set())))[0].messages;
    assert.deepEqual(saved[0].excludedDocuments,[{name:'中文材料.docx'}]);assert.equal(saved[0].exclusionReason,reason);assert.equal(saved[0].documents,undefined);
    for(const secret of ['synthetic-document-prompt','private-id','private-hash'])assert(!JSON.stringify(saved).includes(secret));
    assert.deepEqual(modelHistory([...saved,{id:'next',role:'user',content:'继续提问'}]),[{role:'user',content:'继续提问'}]);
  }
});
test('late Monitor persistence cannot save another unreviewed pending turn', () => {
  const sessions = [{ id: 's', title: 'test', messages: [{ id: 'old', role: 'assistant', content: 'safe' }, { id: 'pending-user', role: 'user', content: 'unreviewed' }, { id: 'pending-reply', role: 'assistant', content: '' }] }];
  const safe = safeSessionSnapshot(sessions, new Set(['pending-user', 'pending-reply']));
  assert.equal(safe[0].messages.length, 1); assert.equal(JSON.stringify(safe).includes('unreviewed'), false);
  assert.equal(sessions[0].messages.length, 3);
});
test('pagination clamps shrinking results and preserves valid empty state', () => {
  assert.deepEqual(pageWindow(29, 9), { page: 3, pages: 3, from: 20, to: 29 });
  assert.deepEqual(pageWindow(0, 2), { page: 1, pages: 1, from: 0, to: 0 });
});
test('CSV export prevents formula execution and keeps embedded newlines', () => {
  assert.equal(csvCell('=1+1'), '"\'=1+1"'); assert.equal(csvCell(3), '"3"'); assert.equal(csvCell('a"b\nc'), '"a""b\nc"');
});
test('missing metrics stay missing and themes reject invalid values', () => {
  assert.equal(number(null), '—'); assert.equal(number(NaN), '—'); assert.equal(number(0), '0.00');
  assert.equal(readTheme('invalid'), 'system'); assert.equal(readTheme('dark'), 'dark'); assert.equal(safeFilename('a/b:*'), 'a-b--');
});
