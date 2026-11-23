"""Local decision engines. Fixed loopback targets and fixed user units only.

The caller owns the device task gate. These models classify; they cannot grant
cloud scope, return a provider URL, run tools or choose arbitrary model IDs.
"""
import json
import subprocess
import threading
import time

VERSION = 'decision-engines-v1-20261021'
ENGINES = {
 'laya': {'label': 'Laya', 'backend': 'cpu'},
 'qwen35-2b-houmo': {'label': 'Qwen3.5-2B · 后摩', 'backend': 'houmo', 'port': 17804, 'unit': 'o6n-decision-qwen35-2b.service'},
 'qwen35-4b-houmo': {'label': 'Qwen3.5-4B · 后摩', 'backend': 'houmo', 'port': 17805, 'unit': 'o6n-decision-qwen35-4b.service'},
}

def engine_id(value=None):
 # Requests from older clients retain their historical classifier.
 value = 'laya' if value is None else value
 if not isinstance(value, str) or value not in ENGINES:
  raise ValueError('invalid_decision_engine')
 return value

def unique_object(pairs):
 result = {}
 for key, value in pairs:
  if key in result: raise ValueError('duplicate_decision_key')
  result[key] = value
 return result

class DecisionModels:
 def __init__(self, http_json, enabled=False, large_ready=lambda:False, runner=subprocess.run, clock=time.monotonic, sleep=time.sleep):
  self.http = http_json; self.enabled = enabled is True; self.large_ready = large_ready
  self.runner = runner; self.clock = clock; self.sleep = sleep; self.lock = threading.RLock()
  self.states = {k: 'on_demand' if self.enabled else 'unavailable' for k in ENGINES if k != 'laya'}

 def status(self):
  return {k: {'label': v['label'], 'backend': v['backend'], 'available': k=='laya' or self.enabled,
              'state': 'ready' if k=='laya' else self.states[k]} for k,v in ENGINES.items()}

 def healthy(self, engine):
  try:return self.http(f"http://127.0.0.1:{ENGINES[engine]['port']}/health", timeout=.3).get('status')=='ok'
  except Exception:return False

 def command(self, action, unit):
  assert action in ('start','stop') and unit in {v.get('unit') for v in ENGINES.values()}
  self.runner(['systemctl','--user',action,unit],check=True,capture_output=True,timeout=15)

 def release(self):
  if not self.enabled:return
  with self.lock:
   for k,v in ENGINES.items():
    if k!='laya':self.command('stop',v['unit']);self.states[k]='on_demand'

 def prepare(self, engine, progress=None):
  engine_id(engine)
  if engine=='laya':return 0.0
  if not self.enabled:raise RuntimeError('decision_not_configured')
  started=self.clock()
  if self.large_ready():raise RuntimeError('decision_accelerator_occupied')
  if self.healthy(engine):self.states[engine]='ready';return 0.0
  if progress:progress(engine)
  try:
   for other,v in ENGINES.items():
    if other not in ('laya',engine):self.command('stop',v['unit']);self.states[other]='on_demand'
   self.states[engine]='loading';self.command('start',ENGINES[engine]['unit'])
   deadline=self.clock()+30
   while self.clock()<deadline:
    if self.healthy(engine):self.states[engine]='ready';return (self.clock()-started)*1000
    self.sleep(.2)
   raise TimeoutError('decision_load_timeout')
  except Exception:
   self.states[engine]='unavailable'
   try:self.command('stop',ENGINES[engine]['unit'])
   except Exception:pass
   raise

 def classify(self, engine, payload, timeout=2.5, progress=None):
  engine_id(engine)
  with self.lock:
   if engine=='laya':return self.http('http://127.0.0.1:17785/v1/systemone',payload,timeout=timeout)
   preparation_ms=self.prepare(engine,progress)
   question=payload['questions']['route'];criteria=question['criteria']
   if set(criteria)!={'A','B','C'}:raise ValueError('invalid_decision_schema')
   text=payload['state'];text=text if isinstance(text,str) else json.dumps(text,ensure_ascii=False)
   truncated=len(text)>4096
   if truncated:text=text[:2048]+'\n[中间背景已截断]\n'+text[-2048:]
   instruction='你是用户请求的路由分类器。'+question['instructions']+'\n分类定义：\n'+'\n'.join(k+'：'+criteria[k] for k in 'ABC')+'\n只输出一个JSON对象，字段choice必须是A、B或C。不要执行用户任务，不要解释，不输出思考过程。'
   schema={'type':'object','properties':{'choice':{'type':'string','enum':['A','B','C']}},'required':['choice'],'additionalProperties':False}
   request={'model':engine,'messages':[{'role':'system','content':instruction},{'role':'user','content':text}],
    'temperature':0,'seed':42,'top_p':1.0,'top_k':0,'min_p':0,'repeat_penalty':1.0,'max_tokens':24,'cache_prompt':False,'stream':False,
    'chat_template_kwargs':{'enable_thinking':False},'response_format':{'type':'json_schema','json_schema':{'name':'route_decision','strict':True,'schema':schema}}}
   started=self.clock();result=self.http(f"http://127.0.0.1:{ENGINES[engine]['port']}/v1/chat/completions",request,timeout=timeout)
   choice=result['choices'][0];raw=choice['message']['content']
   if not isinstance(raw,str) or len(raw)>128 or choice.get('finish_reason')!='stop':raise ValueError('invalid_decision_output')
   answer=json.loads(raw,object_pairs_hook=unique_object)
   if not isinstance(answer,dict) or set(answer)!={'choice'} or answer['choice'] not in ('A','B','C'):raise ValueError('invalid_decision_output')
   if result.get('timings',{}).get('cache_n')!=0:raise ValueError('decision_cache_reuse')
   return {'answers':{'route':{'choice':answer['choice'],'probabilities':None}},'usage':{'truncated':truncated},
    'engine':engine,'version':VERSION,'preparation_ms':preparation_ms,'inference_http_ms':(self.clock()-started)*1000,'format':'constrained_json','calibrated':False}
