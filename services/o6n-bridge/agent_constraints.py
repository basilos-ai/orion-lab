"""One-shot, server-owned generation contracts, downstream of the safety gateway.

No schema arrives from browser headers. Only a matching model and full transcript
can consume a short-lived contract admitted by the Agent lease.
"""
import copy,hashlib,json,secrets,threading,time
from agent_protocol import output_spec,TOOLS

def generation_schema(tools,spec,final_only=False):
 spec=output_spec(spec)
 def obj(props):return {'type':'object','properties':props,'required':list(props),'additionalProperties':False}
 final=obj({'type':{'const':'final'},'format':{'const':spec['format']},
  ('data' if spec['format']=='json' else 'content'):copy.deepcopy(spec.get('schema',{'type':'object'}) if spec['format']=='json' else {'type':'string'})})
 choices=[]
 if not final_only:
  for tool in tools:
   f=tool['function'];name=f['name']
   if name not in TOOLS:raise ValueError('tool_not_allowed')
   params=copy.deepcopy(f.get('parameters',{'type':'object','properties':{}}));params['additionalProperties']=False
   choices.append(obj({'type':{'const':'tool'},'name':{'const':name},'arguments':params}))
 return {'anyOf':choices+[final]} if choices else final

def fingerprint(model,messages):
 return hashlib.sha256(json.dumps([model,messages],ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()

class GenerationContracts:
 def __init__(self,clock=time.monotonic):self.clock=clock;self.lock=threading.Lock();self.entries={}
 def register(self,model,messages,schema,run):
  with self.lock:
   self.entries={k:v for k,v in self.entries.items() if v['expires']>self.clock()}
   if len(self.entries)>=8:raise ValueError('generation_contract_limit')
   ticket=secrets.token_urlsafe(32)
   self.entries[ticket]={'fingerprint':fingerprint(model,messages),'schema':copy.deepcopy(schema),'run':run,'expires':self.clock()+180,'applied':False}
   return ticket
 def apply(self,payload):
  key=fingerprint(payload.get('model'),payload.get('messages'))
  with self.lock:
   for entry in self.entries.values():
    if entry['expires']>self.clock() and not entry['applied'] and entry['fingerprint']==key:
     entry['applied']=True
     return {**payload,'response_format':{'type':'json_object','schema':copy.deepcopy(entry['schema'])}},entry['run']
  return payload,None
 def applied(self,ticket):
  with self.lock:return bool(self.entries.get(ticket,{}).get('applied'))
 def remove(self,ticket):
  with self.lock:self.entries.pop(ticket,None)
