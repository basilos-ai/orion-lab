"""Loopback-only experimental GLiNER classifier. No production routing or tools."""
import collections,http.server,json,os,pathlib,threading,time

def memory():
 result={}
 for line in pathlib.Path('/proc/self/status').read_text().splitlines():
  if line.startswith(('VmRSS:','VmHWM:','VmSwap:')):
   key,value,*_=line.split();result[key.rstrip(':')]=int(value)/1024
 return result

def validate(payload):
 if not isinstance(payload,dict) or set(payload)-{'state','questions'}:raise ValueError('invalid_request')
 text=payload.get('state');questions=payload.get('questions')
 if not isinstance(text,str) or not 0<len(text)<=3000:raise ValueError('invalid_state')
 if not isinstance(questions,dict) or set(questions)!={'route'}:raise ValueError('invalid_questions')
 q=questions['route']
 if not isinstance(q,dict) or set(q)!={'type','instructions','criteria'} or q.get('type')!='choice':raise ValueError('invalid_questions')
 if not isinstance(q['instructions'],str) or not 0<len(q['instructions'])<=1000:raise ValueError('invalid_instructions')
 if not isinstance(q['criteria'],dict) or set(q['criteria'])!={'A','B','C'} or any(not isinstance(v,str) or not 0<len(v)<=500 for v in q['criteria'].values()):raise ValueError('invalid_criteria')
 return text,q

def serve():
 started=time.perf_counter();os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',USE_TF='0',TOKENIZERS_PARALLELISM='false')
 import torch,transformers,gliner2
 from gliner2 import AutoExtractor
 from gliner2.classification import Classifier,ClassificationSchema,ClassificationConfig
 torch.set_num_threads(8);torch.set_num_interop_threads(1);torch.manual_seed(42)
 root=pathlib.Path(os.environ['GLINER_ROOT']).resolve()
 model=AutoExtractor.from_pretrained(str(root/'model'),local_files_only=True,map_location='cpu').float().eval()
 classifier=Classifier(model,device='cpu',dtype=torch.float32).eval();observed={};encode=model.encode_tokens
 def measured_encode(batch,*args,**kwargs):
  observed['encoded_tokens']=int(batch.attention_mask.sum().item());observed['padded_tokens']=int(batch.input_ids.shape[-1])
  return encode(batch,*args,**kwargs)
 model.encode_tokens=measured_encode
 startup={'repository':'fastino/GLiNER2.5-multi-Decide','revision':json.loads((root/'model-manifest.json').read_text())['revision'],'parameters':sum(p.numel() for p in model.parameters()),'device':'cpu','dtype':str(next(model.parameters()).dtype),'threads':torch.get_num_threads(),'interop_threads':torch.get_num_interop_threads(),'affinity':sorted(os.sched_getaffinity(0)),'pid':os.getpid(),'gliner2':gliner2.__version__,'torch':torch.__version__,'transformers':transformers.__version__,'max_len':512,'calibrated':False,'process_to_loaded_s':time.perf_counter()-started,'loaded_memory_mib':memory()}
 assert next(model.parameters()).device.type=='cpu'
 (root/'startup.json').write_text(json.dumps(startup,indent=2));gate=threading.Lock();samples=collections.deque(maxlen=2000);sample_lock=threading.Lock()
 def sampler():
  try:os.sched_setaffinity(0,{2,3,4,5})
  except OSError:pass
  while True:
   with sample_lock:samples.append((time.perf_counter(),memory()['VmRSS']))
   time.sleep(.1)
 threading.Thread(target=sampler,daemon=True).start()
 class Handler(http.server.BaseHTTPRequestHandler):
  def log_message(self,*args):pass
  def send_json(self,value,status=200):
   raw=json.dumps(value,ensure_ascii=False,allow_nan=False).encode();self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(raw)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(raw)
  def do_GET(self):
   if self.path!='/api/health':return self.send_json({'code':'not_found'},404)
   return self.send_json({'status':'ready',**startup,'busy':gate.locked(),'current_memory_mib':memory()})
  def do_POST(self):
   if self.path!='/v1/classify':return self.send_json({'code':'not_found'},404)
   if self.headers.get('Origin'):return self.send_json({'code':'browser_requests_disabled'},403)
   try:
    size=int(self.headers.get('Content-Length','0'))
    if not 0<size<=24000:return self.send_json({'code':'body_limit'},413)
    if self.headers.get('Content-Type','').split(';')[0]!='application/json':return self.send_json({'code':'content_type'},415)
    text,q=validate(json.loads(self.rfile.read(size)))
    if not gate.acquire(blocking=False):return self.send_json({'code':'busy'},429)
    try:
     before=memory();start=time.perf_counter();observed.clear()
     schema=ClassificationSchema().single('route',q['criteria'],instruction=q['instructions'])
     result=classifier.classify(text,schema,config=ClassificationConfig(max_len=512,batch_size=1));answer=result['route']
     elapsed=(time.perf_counter()-start)*1000;after=memory()
     with sample_lock:peaks=[v for t,v in samples if t>=start]
     probs=dict(answer.probabilities)
     return self.send_json({'answers':{'route':{'choice':answer.label,'probabilities':probs}},'usage':{**observed,'truncation_checked':False},'metrics':{'inference_ms':elapsed,'rss_mib':after['VmRSS'],'request_sampled_peak_rss_mib':max([before['VmRSS'],after['VmRSS'],*peaks]),'process_hwm_mib':after['VmHWM'],'swap_mib':after.get('VmSwap',0),'cpu_threads':8,'device':'cpu','dtype':'float32','calibrated':False}})
    finally:gate.release()
   except (ValueError,TypeError,KeyError):return self.send_json({'code':'invalid_request'},400)
   except Exception:
    import traceback;traceback.print_exc();return self.send_json({'code':'inference_failed'},500)
 print(json.dumps({'ready':startup}),flush=True)
 http.server.ThreadingHTTPServer(('127.0.0.1',int(os.environ.get('GLINER_PORT','17786'))),Handler).serve_forever()

if __name__=='__main__':serve()
