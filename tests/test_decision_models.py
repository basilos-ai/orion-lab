import json,pathlib,sys,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'services/o6n-bridge'))
from decision_models import DecisionModels,ENGINES,engine_id
from agent_routing import AgentRouter,QUESTION

class EngineTests(unittest.TestCase):
 def setUp(self):
  self.active=set();self.commands=[];self.calls=[];self.raw='{"choice":"A"}';self.cache_n=0;self.finish='stop'
  def command(args,**kw):
   action,unit=args[-2:];self.commands.append((action,unit));engine=next(k for k,v in ENGINES.items() if v.get('unit')==unit)
   if action=='start':self.active.add(engine)
   else:self.active.discard(engine)
  def http(url,payload=None,**kw):
   engine=next(k for k,v in ENGINES.items() if str(v.get('port')) in url and k!='laya')
   if url.endswith('/health'):
    if engine not in self.active:raise ConnectionError()
    return {'status':'ok'}
   self.calls.append((engine,payload,kw));return {'choices':[{'message':{'content':self.raw},'finish_reason':self.finish}],'timings':{'cache_n':self.cache_n}}
  self.manager=DecisionModels(http,enabled=True,runner=command)
  self.payload={'state':'只列出文件标题。','questions':QUESTION}
 def test_loads_one_decider_reuses_ready_and_never_stops_answer_units(self):
  a=self.manager.classify('qwen35-2b-houmo',self.payload);self.assertIsNone(a['answers']['route']['probabilities']);self.assertEqual(self.active,{'qwen35-2b-houmo'})
  n=len(self.commands);self.manager.classify('qwen35-2b-houmo',self.payload);self.assertEqual(len(self.commands),n)
  self.manager.classify('qwen35-4b-houmo',self.payload);self.assertEqual(self.active,{'qwen35-4b-houmo'});self.assertTrue(all(u.startswith('o6n-decision-') for _,u in self.commands))
  self.assertFalse(self.calls[-1][1]['cache_prompt']);self.assertEqual(self.calls[-1][1]['max_tokens'],24)
 def test_large_model_is_not_evicted_disabled_or_invalid_engine_cannot_start(self):
  self.manager.large_ready=lambda:True
  with self.assertRaisesRegex(RuntimeError,'occupied'):self.manager.classify('qwen35-4b-houmo',self.payload)
  self.assertEqual(self.commands,[])
  self.manager.enabled=False
  with self.assertRaisesRegex(RuntimeError,'not_configured'):self.manager.classify('qwen35-2b-houmo',self.payload)
  for value in ['gliner','http://remote',None,{},'__proto__']:
   if value is None:self.assertEqual(engine_id(value),'laya')
   else:
    with self.assertRaises(ValueError):engine_id(value)
 def test_strict_json_no_duplicate_keys_no_partial_outputs_no_prefix_reuse(self):
  for raw in ['{"choice":"A","choice":"B"}','{"choice":"A","url":"x"}','```json\n{"choice":"A"}\n```','{"choice":"D"}','[]']:
   self.raw=raw
   with self.assertRaises((ValueError,TypeError)):self.manager.classify('qwen35-2b-houmo',self.payload)
  self.raw='{"choice":"A"}';self.cache_n=1
  with self.assertRaisesRegex(ValueError,'cache_reuse'):self.manager.classify('qwen35-2b-houmo',self.payload)
  self.cache_n=0;self.finish='length'
  with self.assertRaises(ValueError):self.manager.classify('qwen35-2b-houmo',self.payload)
 def test_truncation_is_explicit_not_hidden_as_confidence(self):
  result=self.manager.classify('qwen35-4b-houmo',{**self.payload,'state':'甲'*5000});self.assertTrue(result['usage']['truncated']);self.assertIsNone(result['answers']['route']['probabilities'])

class MultiRouterTests(unittest.TestCase):
 def test_engine_is_cache_bound_local_scope_skips_and_faults_fall_back(self):
  class Fake:
   calls=[];choice='A';fail=False
   def classify(self,engine,payload,**kw):
    self.calls.append(engine)
    if self.fail:raise TimeoutError()
    return {'answers':{'route':{'choice':self.choice,'probabilities':None}},'usage':{'truncated':False}}
  f=Fake();r=AgentRouter(lambda *a:None,engines=f);context={'prompt':'test'}
  def decide(engine,scope='hybrid',**kw):return r.decide('auto',scope,context,'owner','project',True,True,engine,**kw)
  for engine in ['qwen35-2b-houmo','qwen35-4b-houmo']:
   self.assertEqual(decide(engine)['recommended'],'standard');self.assertTrue(decide(engine)['cache_hit'])
  self.assertEqual(len(f.calls),2);self.assertEqual(decide('qwen35-4b-houmo','local')['source'],'scope');self.assertEqual(len(f.calls),2)
  f.choice='B';context={'prompt':'another'};self.assertEqual(decide('qwen35-2b-houmo')['recommended'],'cloud')
  f.fail=True;context={'prompt':'third'};failed=decide('qwen35-4b-houmo');self.assertEqual(failed['recommended'],'standard');self.assertEqual(failed['reason_code'],'decision_unavailable');self.assertTrue(failed['fallback'])
  with self.assertRaises(ValueError):decide('gliner')

if __name__=='__main__':unittest.main()
