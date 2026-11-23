"""Real HTTP bridge lifecycle with synthetic Gateway responses; no model calls."""
import http.client, io, json, pathlib, sys, threading, types, unittest, urllib.error
from contextlib import ExitStack
from unittest.mock import MagicMock, Mock, patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'services/o6n-bridge'))


class ChatRecoveryTests(unittest.TestCase):
 def test_gateway_requires_semantic_verdict_for_exact_history_and_text(self):
  import controlled_bridge as bridge
  messages=[{'role':'user','content':'李白简介1000字'},{'role':'assistant','content':'李白是唐代诗人。'*150},{'role':'user','content':'继续'}]
  rid='prepared-fixture'
  with patch.dict(bridge.prepared_text_reviews,clear=True),patch.object(bridge,'event'),patch.object(bridge,'notify'),patch.object(bridge,'cached',return_value=(0,{},rid)),patch.object(bridge,'http_json') as http:
   for label,verdict in [('Safe','allow'),('Unsafe','block'),('Controversial','block')]:
    http.reset_mock();http.return_value={'label':label}
    bridge.prepare_text_review(messages,rid)
    result,status=bridge.safety({'messages':messages})
    self.assertEqual((status,result['verdict']),(200,verdict))
    http.assert_called_once()
    self.assertEqual(http.call_args.args[1],{'messages':messages,'extended_review':True})
   changed=[messages[0],{'role':'assistant','content':'different history'},messages[-1]]
   http.return_value={'label':'invalid'}
   self.assertEqual(bridge.safety({'messages':changed})[1],503)
   self.assertEqual(http.call_args.args[1],{'messages':changed})
   for cause in ['guard_busy','guard_timeout','guard_input_budget','other']:
    http.side_effect=urllib.error.HTTPError('fixture',503,'guard',{},io.BytesIO(json.dumps({'error':cause}).encode()))
    bridge.prepare_text_review(messages,rid)
    result,status=bridge.safety({'messages':messages})
    self.assertEqual((status,result['error']),(503,cause if cause!='other' else 'safety_unavailable'))

 def test_confirmed_document_blocks_release_task_and_allow_the_next_plain_question(self):
  import controlled_bridge as bridge
  gate = threading.Lock(); calls = []; completed = Mock(); last_block = False
  marker = '[[ORION_DOCUMENT:' + 'a'*32 + ':' + 'b'*64 + ']]'
  docs = Mock()
  docs.context.return_value = ([{'id':'a'*32}], marker + '\nsynthetic blocked material')
  docs.referenced.return_value = [{'id':'a'*32}]
  docs.prepare.return_value = {'verdict':'block','category':'sensitive','reason_code':'document_sensitive'}

  class Response:
   headers = {'X-Request-ID':'safe-gateway-fixture'}
   def __enter__(self): return self
   def __exit__(self, *args): pass
   def __iter__(self):
    yield ('data: ' + json.dumps({'choices':[{'delta':{'content':'4'},'finish_reason':'stop'}]}) + '\n').encode()
    yield b'data: [DONE]\n'

  def upstream(request, **kwargs):
   nonlocal last_block
   payload = json.loads(request.data); calls.append(payload)
   last_block = marker in json.dumps(payload)
   if last_block:
    raise urllib.error.HTTPError(request.full_url, 403, 'blocked', {'X-Request-ID':'blocked-gateway-fixture'}, io.BytesIO(b'{"error":{"code":"guardrail_blocked"}}'))
   return Response()

  class Handler(bridge.Handler):
   def authenticated(self): return True
   def log_message(self, *args): pass

  with ExitStack() as stack:
   database = MagicMock(); database.__enter__.return_value.execute.return_value.fetchall.return_value = []
   replacements = {'documents':docs, 'workspace_prepare':Mock(return_value=None), 'workspace_complete':completed,
    'agent_proxy':types.SimpleNamespace(owner=lambda _: 'fixture-owner'), 'event':Mock(),
    'events':lambda _: [{'kind':'stage','stage':'input_matched','reason_code':'document_sensitive','category':'sensitive'}] if last_block else [],
    'decide':Mock(return_value={'recommended':'standard','difficulty_key':'C','input_hash':'fixture-hash','decision_http_ms':0}),
    'answers':types.SimpleNamespace(prepare=lambda *args:0), 'CONF':{'controlled_gateway_key':'fixture-only'},
    'pool':bridge.concurrent.futures.ThreadPoolExecutor(max_workers=1)}
   for key,value in replacements.items(): stack.enter_context(patch.object(bridge, key, value, create=True))
   stack.callback(replacements['pool'].shutdown, wait=True)
   stack.enter_context(patch.object(bridge.base, 'gate', gate))
   stack.enter_context(patch.object(bridge.base, 'benchmark_active', return_value=False))
   stack.enter_context(patch.object(bridge.base, 'connect', return_value=database))
   stack.enter_context(patch.object(bridge.urllib.request, 'urlopen', side_effect=upstream))
   server = bridge.http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
   thread = threading.Thread(target=server.serve_forever,daemon=True); thread.start()
   try:
    def send(documents,stale_history=False):
     connection = http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=5)
     payload = {'messages':[{'role':'user','content':'计算2+2'}],'mode':'auto','scope':'local','documents':documents}
     if stale_history:payload['messages']=[{'role':'user','content':marker+'\nexpired historical document'},{'role':'assistant','content':'old summary'},*payload['messages']]
     connection.request('POST','/api/chat',json.dumps(payload),{'Content-Type':'application/json'})
     response = connection.getresponse(); frames = [json.loads(line) for line in response.read().splitlines()]; connection.close()
     self.assertEqual(response.status,200); self.assertFalse(gate.locked()); return frames
    for _ in range(3):
     blocked = send(['a'*32]); self.assertEqual(blocked[-1]['code'],'input_blocked'); self.assertEqual(blocked[-1]['reason_code'],'document_sensitive')
     safe = send([]); self.assertEqual(safe[-1]['event'],'done'); self.assertEqual(safe[-1]['answer'],'4')
     self.assertNotIn(marker,json.dumps(calls[-1])); self.assertNotIn('synthetic blocked material',json.dumps(calls[-1]))
    self.assertEqual(completed.call_count,3)
    # An authoritative empty server context must also replace client history.
    # Otherwise stale document IDs sent by a restored browser survive the reset.
    with patch.object(bridge,'workspace_prepare',return_value=[]):
     docs.referenced.reset_mock();docs.referenced.side_effect=bridge.DocumentError('document_denied')
     safe=send([],stale_history=True);self.assertEqual(safe[-1]['event'],'done')
     docs.referenced.assert_not_called();self.assertNotIn(marker,json.dumps(calls[-1]))
   finally: server.shutdown(); server.server_close(); thread.join(2)


if __name__ == '__main__': unittest.main()
