import contextlib, http.client, importlib.util, json, pathlib, sqlite3, sys, tempfile, threading, types, unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]/'services/o6n-bridge'))
from agent_routing import AgentRouter, validate_dispatch
from gateway_protocol import GATEWAY_METADATA_HEADER
import agent_extension


def prediction(choice='A', probabilities=None, truncated=False):
 return {'answers': {'route': {'choice': choice, 'probabilities': probabilities or {'A': .95, 'B': .03, 'C': .02}}}, 'usage': {'truncated': truncated}}


class RoutingTests(unittest.TestCase):
 def setUp(self):
  self.calls = []
  self.answer = prediction()
  self.router = AgentRouter(lambda payload, timeout: self.calls.append((payload, timeout)) or self.answer)
  self.context = {'prompt': '读取项目说明，解释用途。', 'access': 'read', 'files': [], 'truncated': False}

 def decide(self, model='auto', scope='hybrid', **kwargs):
  return self.router.decide(model, scope, kwargs.get('context', self.context), kwargs.get('owner', 'owner-a'), kwargs.get('project', 'demo'), kwargs.get('local_ready', True), kwargs.get('cloud_ready', True))

 def test_local_is_an_absolute_boundary_and_skips_classifier(self):
  for ready in (True, False):
   if ready: self.assertEqual(self.decide(scope='local')['recommended'], 'standard')
   else:
    with self.assertRaisesRegex(ValueError, 'model_not_ready'): self.decide(scope='local', local_ready=False)
  with self.assertRaisesRegex(ValueError, 'cloud_scope_required'): self.decide(model='cloud', scope='local')
  self.assertEqual(self.calls, [])
  for scope, selected in [('local', 'cloud'), ('invalid', 'standard'), ('hybrid', 'large')]:
   with self.assertRaises(ValueError): validate_dispatch(scope, selected)

 def test_laya_selects_both_candidates_and_uncertain_is_not_local(self):
  self.assertEqual(self.decide()['recommended'], 'standard')
  self.answer = prediction('B', {'A': .10, 'B': .85, 'C': .05})
  self.assertEqual(self.decide(context={**self.context, 'prompt': '跨文件排查并发问题'})['recommended'], 'cloud')
  self.answer = prediction('C', {'A': .1, 'B': .2, 'C': .7})
  self.assertEqual(self.decide(context={**self.context, 'prompt': '含糊任务'})['recommended'], 'cloud')
  self.answer = prediction('A', {'A': .38, 'B': .34, 'C': .28})
  self.assertEqual(self.decide(context={**self.context, 'prompt': '低置信度'})['recommended'], 'cloud')

 def test_truncation_invalid_response_timeout_and_cloud_eligibility(self):
  self.assertEqual(self.decide(context={**self.context, 'truncated': True})['recommended'], 'cloud')
  self.answer = prediction(probabilities={'A': float('nan'), 'B': .3, 'C': .1})
  result = self.decide(context={**self.context, 'prompt': 'invalid'})
  self.assertEqual(result['recommended'], 'standard'); self.assertTrue(result['fallback'])
  router = AgentRouter(lambda *_: (_ for _ in ()).throw(TimeoutError()))
  result = router.decide('auto', 'hybrid', self.context, 'o', 'demo', True, True)
  self.assertEqual(result['reason_code'], 'laya_unavailable')
  self.assertEqual(self.decide(cloud_ready=False)['reason_code'], 'cloud_unavailable')
  self.assertEqual(self.decide(local_ready=False)['recommended'], 'cloud')
  with self.assertRaises(ValueError): self.decide(local_ready=False, cloud_ready=False)
  with self.assertRaises(ValueError): self.decide(model='cloud', cloud_ready=False)

 def test_cache_binds_owner_project_scope_and_actual_context(self):
  first = self.decide(); second = self.decide()
  self.assertTrue(second['cache_hit']); self.assertNotEqual(first['decision_id'], second['decision_id']); self.assertEqual(len(self.calls), 1)
  for args in [{'owner': 'owner-b'}, {'project': 'another'}, {'context': {**self.context, 'access': 'edit'}}, {'context': {**self.context, 'prompt': '文件已变'}}]: self.decide(**args)
  self.assertEqual(len(self.calls), 5)
  self.assertEqual(self.decide(cloud_ready=False)['source'], 'availability')


class InternalBridgeTests(unittest.TestCase):
 def test_real_http_admission_and_each_model_round_enforce_frozen_route(self):
  with tempfile.TemporaryDirectory() as tmp:
   events, classifier_calls, dispatches = [], [], []
   database = pathlib.Path(tmp)/'events.sqlite'
   with contextlib.closing(sqlite3.connect(database)) as db:
    db.execute('CREATE TABLE events(kind TEXT, created TEXT)'); db.commit()
   base = types.SimpleNamespace(CONF={'controlled_gateway_key': 'fixture', 'cloud_daily_limit': 100}, LAYA='local-fixture', GATEWAY='https://fixture.invalid/v1/chat/completions', gate=threading.Lock(), db_lock=threading.Lock(), connect=lambda: sqlite3.connect(database), now=lambda: '2026-10-21T00:00:00', healthy=lambda _: True, benchmark_active=lambda: False, event=lambda k,r,d: events.append((k,r,d)), http_json=lambda *a,**k: classifier_calls.append(a) or prediction('B', {'A': .05, 'B': .9, 'C': .05}), inspect_messages=lambda m: (m,0))
   controlled = types.SimpleNamespace(input_policy=types.SimpleNamespace(check=lambda _: {'blocked': False}, redact=lambda s:s), REGISTRY={'standard': {'logical': 'local-fixture'}, 'cloud': {'logical': 'cloud-fixture'}}, remember=lambda *args: None)
   proxy = agent_extension.install(base, controlled, internal_port=0, state_root=pathlib.Path(tmp)/'state')
   server = proxy.internal_server
   token = (pathlib.Path(tmp)/'state/internal-token').read_text()
   def post(route, body, lease=None):
    connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=5)
    headers={'Authorization': 'Bearer '+token, 'Content-Type': 'application/json'}
    if lease: headers['X-Orion-Lease']=lease
    connection.request('POST', route, json.dumps(body), headers); response=connection.getresponse(); data=response.read(); status=response.status; connection.close();return status,data
   class Response:
    headers={'X-Request-ID':'fixture-request'}
    def __enter__(self):return self
    def __exit__(self,*args):pass
    def __iter__(self):
     yield ('data: '+json.dumps({'choices':[{'delta':{'content':'{"answer":"完成"}'},'finish_reason':None}],'usage':{'prompt_tokens':10,'completion_tokens':2}})+'\n').encode()
     yield b'data: [DONE]\n'
   def upstream(req, **kwargs):
    metadata=json.loads(req.get_header(GATEWAY_METADATA_HEADER.capitalize()))
    self.assertIn(metadata['route'],('standard','cloud'))
    dispatches.append(json.loads(req.data));return Response()
   try:
    with patch.object(agent_extension.urllib.request, 'urlopen', upstream):
     status,_=post('/agent/start',{'run':'a'*36,'model':'cloud','scope':'local'});self.assertEqual(status,403)
     status,data=post('/agent/start',{'run':'a'*36,'model':'auto','scope':'local'});self.assertEqual(status,200);admission=json.loads(data);self.assertEqual(admission['selected'],'standard');self.assertFalse(classifier_calls)
     message={'model':'standard','messages':[{'role':'user','content':'测试任务'}],'tools':[]}
     for _ in range(2):self.assertEqual(post('/v1/chat/completions',message,admission['lease'])[0],200)
     for tampered in [{**message,'model':'cloud'},{**message,'scope':'hybrid'},{**message,'decision_engine':'qwen35-4b-houmo'}]:self.assertEqual(post('/v1/chat/completions',tampered,admission['lease'])[0],400)
     self.assertTrue(all(d['model']=='local-fixture' for d in dispatches));self.assertEqual(len(dispatches),2)
     post('/agent/end',{'run':'a'*36,'lease':admission['lease']})
     status,data=post('/agent/start',{'run':'b'*36,'model':'auto','scope':'hybrid','context':{'prompt':'复杂任务'},'owner':'fixture','project':'demo'});self.assertEqual(status,200);admission=json.loads(data);self.assertEqual(admission['selected'],'cloud');self.assertEqual(len(classifier_calls),1)
     for _ in range(2):self.assertEqual(post('/v1/chat/completions',{**message,'model':'cloud'},admission['lease'])[0],200)
     self.assertEqual(len(classifier_calls),1);self.assertTrue(all(d['model']=='cloud-fixture' for d in dispatches[2:]))
     self.assertEqual(post('/v1/chat/completions',message,admission['lease'])[0],400)
     post('/agent/end',{'run':'b'*36,'lease':admission['lease']})
     self.assertFalse(base.gate.locked())
     with contextlib.closing(sqlite3.connect(database)) as db:
      db.executemany('INSERT INTO events(kind,created) VALUES(?,?)',[('cloud_attempt','2026-10-21T00:00:00')]*100);db.commit()
     status,data=post('/agent/start',{'run':'c'*36,'model':'auto','scope':'hybrid','context':{'prompt':'复杂任务'},'owner':'fixture','project':'demo'});self.assertEqual(status,200);admission=json.loads(data);self.assertEqual(admission['selected'],'standard');self.assertEqual(admission['decision']['reason_code'],'cloud_unavailable');self.assertEqual(len(classifier_calls),1)
     post('/agent/end',{'run':'c'*36,'lease':admission['lease']});self.assertFalse(base.gate.locked())
   finally:server.shutdown();server.server_close()


if __name__ == '__main__':unittest.main()
