"""Fixed local answer targets; preparation never evicts the manual 27B model."""
import subprocess
import time

LOCAL_MODELS = {
 'small': {'label':'Qwen3.5-4B · 后摩','model':'qwen35-4b-houmo','logical':'o6n-small','port':17805,'unit':'o6n-decision-qwen35-4b.service','engine':'qwen35-4b-houmo','context':4096},
 'tiny': {'label':'Qwen3.5-2B · 后摩','model':'qwen35-2b-houmo','logical':'o6n-tiny','port':17804,'unit':'o6n-decision-qwen35-2b.service','engine':'qwen35-2b-houmo','context':4096},
 'vision': {'label':'MiniCPM-V 4.7 1B · CPU','model':'MiniCPM-V-4.7-1B-Q4_K_M','logical':'o6n-vision','port':17747,'unit':'minicpm47.service','context':4096,'vision':True},
 'cpu': {'label':'MiniCPM5-2B · CPU','model':'MiniCPM5-2B-Q4_K_M','logical':'o6n-cpu','port':17752,'unit':'minicpm5-2b.service','context':4096},
}

class AnswerModels:
 def __init__(self, engines, healthy, runner=subprocess.run, clock=time.monotonic, sleep=time.sleep):
  self.engines=engines;self.healthy=healthy;self.runner=runner;self.clock=clock;self.sleep=sleep

 def prepare(self, route, progress=None):
  if route not in LOCAL_MODELS:return 0.0
  model=LOCAL_MODELS[route]
  if model.get('engine'):return self.engines.prepare(model['engine'],lambda _:progress(route) if progress else None)
  if self.healthy(model['port']):return 0.0
  if progress:progress(route)
  started=self.clock()
  self.runner(['systemctl','--user','start',model['unit']],check=True,capture_output=True,timeout=15)
  deadline=self.clock()+35
  while self.clock()<deadline:
   if self.healthy(model['port']):return (self.clock()-started)*1000
   self.sleep(.2)
  raise TimeoutError('answer_load_timeout')

def prompt_fits(http, model, messages, max_tokens):
 """Count the server's real rendered text template, not bare user text."""
 if any(isinstance(m.get('content'),list) for m in messages):return True  # Multimodal server enforces its own image-token budget.
 base=f"http://127.0.0.1:{model['port']}"
 prompt=http(base+'/apply-template',{'messages':messages,'add_generation_prompt':True,'chat_template_kwargs':{'enable_thinking':False}},timeout=4)['prompt']
 tokens=http(base+'/tokenize',{'content':prompt,'add_special':False},timeout=4)['tokens']
 return len(tokens)+max_tokens+32<=model['context']

def merge_image_context(prior, sent):
 """Restore validated browser images without replacing authoritative text.

 Recent reverse-order alignment disambiguates repeated prompts. Unrelated
 client turns cannot attach images to a different completed prompt.
 """
 result=[dict(m) for m in prior];end=len(sent)-1
 def text(content):return content if isinstance(content,str) else '\n'.join(p.get('text','') for p in content if p.get('type')=='text')
 for i in range(len(result)-1,-1,-1):
  authoritative=result[i]
  for j in range(end-1,-1,-1):
   candidate=sent[j]
   if candidate['role']==authoritative['role'] and text(candidate['content'])==text(authoritative['content']):
    end=j
    if candidate['role']=='user' and isinstance(candidate['content'],list):
     images=[p for p in candidate['content'] if p.get('type')=='image_url']
     if images:result[i]['content']=[{'type':'text','text':text(authoritative['content'])},*images]
    break
 return [*result,sent[-1]]
