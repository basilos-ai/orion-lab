"""Loopback-only Qwen3Guard CPU service. Never logs prompt text."""
import os,pathlib,json,time,threading,http.server,re,urllib.request,hashlib
os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',USE_TF='0',TOKENIZERS_PARALLELISM='false')
import torch
from transformers import AutoTokenizer,AutoModelForCausalLM
ROOT=pathlib.Path('/home/radxa/o6n-qwen3guard');MODEL=ROOT/'model'
torch.set_num_threads(4);torch.set_num_interop_threads(1)
tokenizer=AutoTokenizer.from_pretrained(MODEL,local_files_only=True,trust_remote_code=False)
BACKEND=os.environ.get('O6N_GUARD_BACKEND','torch-fp32')
model=None if BACKEND=='llama-q8' else AutoModelForCausalLM.from_pretrained(MODEL,local_files_only=True,trust_remote_code=False,torch_dtype=torch.float32,attn_implementation='sdpa').eval()
gate=threading.Lock()
engine_lane=threading.Lock()
# Only digests and lengths describe the active engine slot. No verdict is cached here.
warm_context=None
warm_length=0
warm_digest=None

def digest(text):
 return hashlib.sha256(text.encode('utf-8')).digest()

def context_key(messages):
 return digest(json.dumps(messages,sort_keys=True,ensure_ascii=False))

def warm_prefix(messages,answer):
 global warm_length,warm_digest,warm_context
 if BACKEND!='llama-q8' or gate.locked() or not engine_lane.acquire(blocking=False):return
 try:
  if gate.locked() or context_key(messages)!=warm_context or len(answer)<=warm_length:return
  if warm_length and digest(answer[:warm_length])!=warm_digest:return
  # Bound each speculative step so a foreground review only waits for one slice.
  prefix=answer[:warm_length+192]
  marker='__ORION_ASSISTANT_PREFIX_END__'
  conversation=[*messages,{'role':'assistant','content':prefix+marker},{'role':'user','content':''}]
  rendered=tokenizer.apply_chat_template(conversation,tokenize=False)
  prompt,found,_=rendered.rpartition(marker)
  if not found or not prompt.endswith(prefix):return
  if len(tokenizer(prompt)['input_ids'])>=8192:return
  req=urllib.request.Request('http://127.0.0.1:17793/completion',data=json.dumps({'prompt':prompt,'n_predict':1,'temperature':0,'cache_prompt':True,'stream':False}).encode(),headers={'Content-Type':'application/json'})
  with urllib.request.urlopen(req,timeout=20) as response:response.read()
  warm_length=len(prefix);warm_digest=digest(prefix)
 except Exception:
  warm_context=None
 finally:engine_lane.release()
def rss():
 return {a.split(':')[0]:int(a.split()[1])/1024 for a in pathlib.Path('/proc/self/status').read_text().splitlines() if a.startswith(('VmRSS:','VmHWM:'))}
def predict(messages, *, extended_review=False):
 global warm_context,warm_length,warm_digest
 if not gate.acquire(timeout=.2):raise RuntimeError('guard_busy')
 try:
  start=time.perf_counter()
  engine_lane.acquire()
  warm_context=None;warm_length=0;warm_digest=None
  text=tokenizer.apply_chat_template(messages,tokenize=False)
  inputs=tokenizer(text,return_tensors='pt')
  n=inputs['input_ids'].shape[1]
  if n>8192:raise ValueError('guard_input_budget')
  if BACKEND=='llama-q8':
   req=urllib.request.Request('http://127.0.0.1:17793/completion',data=json.dumps({'prompt':text,'n_predict':16,'temperature':0,'seed':42,'cache_prompt':True,'stream':False,'stop':['\n','<|im_end|>']}).encode(),headers={'Content-Type':'application/json'})
   try:
    with urllib.request.urlopen(req,timeout=120 if extended_review else 30) as response:result=json.load(response)
   except TimeoutError as error:raise RuntimeError('guard_timeout') from error
   output=result['content'];out_tokens=result['tokens_predicted']
  else:
   with torch.inference_mode():ids=model.generate(**inputs,max_new_tokens=48,do_sample=False,use_cache=True,pad_token_id=tokenizer.eos_token_id)
   output=tokenizer.decode(ids[0,n:],skip_special_tokens=True);out_tokens=ids.shape[1]-n
  m=re.search(r'Safety:\s*(Safe|Unsafe|Controversial)',output)
  if not m:raise RuntimeError('guard_invalid_output')
  if BACKEND=='llama-q8' and m[1]=='Safe':warm_context=context_key(messages)
  c=re.search(r'Categories:\s*([^\n]+)',output)
  return {'label':m[1],'categories':c[1].strip() if c else 'not_requested','input_tokens':n,'output_tokens':out_tokens,'inference_ms':(time.perf_counter()-start)*1000,'model':'Qwen3Guard-Gen-0.6B','backend':BACKEND,'format':'safety-label-only' if BACKEND=='llama-q8' else 'full-label-and-categories','prefix_cache':BACKEND=='llama-q8','runtime_timings':result.get('timings') if BACKEND=='llama-q8' else None,'revision':'fada3b2f655b89601929198343c94cd2f64d93cc','memory_mib':rss()}
 finally:engine_lane.release();gate.release()
class Handler(http.server.BaseHTTPRequestHandler):
 def reply(self,d,status=200):
  b=json.dumps(d,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b)
 def do_GET(self):self.reply({'status':'ok','model':'Qwen3Guard-Gen-0.6B','backend':BACKEND,'dtype':'Q8_0' if BACKEND=='llama-q8' else 'float32','threads':4,'memory_mib':rss()} if self.path=='/health' else {'error':'not_found'},200 if self.path=='/health' else 404)
 def do_POST(self):
  try:
   n=int(self.headers.get('Content-Length','0'))
   if self.path not in ('/moderate','/warm-prefix') or not 0<n<150000:raise ValueError('invalid_request')
   p=json.loads(self.rfile.read(n));messages=p['messages']
   if not isinstance(messages,list) or not messages:raise ValueError('invalid_messages')
   if self.path=='/warm-prefix':
    answer=p.get('answer')
    if not isinstance(answer,str) or len(answer)>16000:raise ValueError('invalid_request')
    warm_prefix(messages,answer)
    return self.reply({'status':'ok'})
   self.reply(predict(messages,extended_review=p.get('extended_review') is True))
  except (ValueError,RuntimeError) as e:self.reply({'error':str(e)},503)
  except (BrokenPipeError,ConnectionResetError):pass
  except Exception:self.reply({'error':'guard_unavailable'},503)
 def log_message(self,*args):pass
if __name__=='__main__':
 warm=predict([{'role':'user','content':'你好，请介绍一下自己。'}]);(ROOT/'startup.json').write_text(json.dumps({'warmup':warm,'memory_mib':rss()},ensure_ascii=False))
 print('QWEN3GUARD_READY',flush=True)
 http.server.ThreadingHTTPServer(('127.0.0.1',17792),Handler).serve_forever()
