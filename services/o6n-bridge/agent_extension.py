"""Pi sidecar transport. Native AI Gateway sources are never spoofed.

The companion hooks reuse the deployed input policy/Qwen3Guard. Model calls
still traverse AI Gateway's published input Block and Laya Monitor policies.
"""
import contextlib,datetime,hashlib,hmac,http.server,json,pathlib,re,secrets,threading,time,urllib.error,urllib.parse,urllib.request,uuid
from gateway_protocol import GATEWAY_METADATA_HEADER
from agent_routing import AgentRouter, validate_dispatch
from decision_models import engine_id
from agent_constraints import GenerationContracts, generation_schema

MAX_BODY=128*1024
TOOLS={'list_files','read_file','search_files','write_file','run_check','create_directory'}

def text_parts(content):
 if isinstance(content,str):return content
 if isinstance(content,list) and all(isinstance(p,dict) and p.get('type')=='text' and isinstance(p.get('text'),str) for p in content):return '\n'.join(p['text'] for p in content)
 if content is None:return ''
 raise ValueError('agent_text_only')

# Compatibility exports for existing integrations and protocol fixtures.
from agent_protocol import (VERSION as PROTOCOL_VERSION, ProtocolStream, FinalFormatError,
 output_spec, request as tool_protocol_request, response as tool_protocol_response)

def guard_messages(messages):
 if not isinstance(messages,list) or not 1<=len(messages)<=40:raise ValueError('agent_message_limit')
 result=[];total=0
 for message in messages:
  if not isinstance(message,dict) or message.get('role') not in ('system','user','assistant','tool'):raise ValueError('agent_message_invalid')
  content=message.get('content') or ''
  if isinstance(content,list):
   if any(not isinstance(p,dict) or p.get('type')!='text' or not isinstance(p.get('text'),str) for p in content):raise ValueError('agent_text_only')
   content='\n'.join(p['text'] for p in content)
  if not isinstance(content,str):raise ValueError('agent_text_only')
  calls=message.get('tool_calls',[])
  if calls:
   if not isinstance(calls,list) or len(calls)>8:raise ValueError('agent_tool_limit')
   for call in calls:
    if call.get('function',{}).get('name') not in TOOLS:raise ValueError('agent_tool_denied')
   content+='\n'+json.dumps(calls,ensure_ascii=False)
  if not content:continue
  text='['+message['role']+'] '+content;total+=len(text)
  if total>8192:raise ValueError('agent_context_budget')
  result.append({'role':'assistant' if message['role']=='assistant' else 'user','content':text})
 if not result:raise ValueError('agent_empty_messages')
 # Guard-only representation. The original tool transcript is forwarded intact.
 if result[-1]['role']!='user':result.append({'role':'user','content':'请继续处理以上任务。'})
 return result

def device_identity(headers, token, address):
 # Persistent, signed device identity; IP remains only the legacy migration alias.
 match=re.search(r'(?:^|;\s*)orion_device=([a-f0-9]{32})\.([a-f0-9]{64})(?:;|$)',headers.get('Cookie',''))
 if match and hmac.compare_digest(match[2],hmac.new(token.encode(),('device-id:'+match[1]).encode(),hashlib.sha256).hexdigest()):
  return hmac.new(token.encode(),('principal:'+match[1]).encode(),hashlib.sha256).hexdigest()
 return hmac.new(token.encode(),('device:'+address).encode(),hashlib.sha256).hexdigest()

def device_cookie(headers,token):
 match=re.search(r'(?:^|;\s*)orion_device=([a-f0-9]{32})\.([a-f0-9]{64})(?:;|$)',headers.get('Cookie',''))
 if match and hmac.compare_digest(match[2],hmac.new(token.encode(),('device-id:'+match[1]).encode(),hashlib.sha256).hexdigest()):return None
 value=secrets.token_hex(16);signature=hmac.new(token.encode(),('device-id:'+value).encode(),hashlib.sha256).hexdigest()
 return f'orion_device={value}.{signature}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000'

def completed_chat_context(record, current_text, new_documents=False):
 """Keep the latest completed document turn when the ordinary 3k window omits it."""
 ordinary=record.get('context',[])
 if new_documents:
  # A replacement upload must not depend on old document IDs, which may be expired.
  return [] if any('[[ORION_DOCUMENT:' in str(m.get('content','')) for m in ordinary) else ordinary
 turns=record.get('turns',[])[-6:]
 positions=[i for i,t in enumerate(turns) if '[[ORION_DOCUMENT:' in t.get('prompt','')]
 if not positions:return ordinary
 chosen=turns[positions[-1]:];budget=max(0,24000-len(current_text))
 if sum(len(t['prompt'])+len(t['answer']) for t in chosen)>budget:raise ValueError('文档上下文过长，请缩短问题或新建对话重新上传。')
 return [message for t in chosen for message in [{'role':'user','content':t['prompt']},{'role':'assistant','content':t['answer']}]]

def install(base,controlled,internal_port=17794,state_root=None):
 state=pathlib.Path(state_root) if state_root else pathlib.Path.home()/'.local/state/orion-agent';state.mkdir(parents=True,exist_ok=True);state.chmod(0o700)
 token_file=state/'internal-token'
 if not token_file.exists():token_file.write_text(secrets.token_urlsafe(48));token_file.chmod(0o600)
 token=token_file.read_text().strip();lease={};cancelled={};lock=threading.Lock()
 router=AgentRouter(lambda payload,timeout:base.http_json(base.LAYA,payload,timeout=timeout),engines=getattr(controlled,'engines',None))
 contracts=GenerationContracts()
 def constrain(payload):
  result,run=contracts.apply(payload)
  if run:base.event('agent_constraint',run,{'version':PROTOCOL_VERSION,'applied':True,'engine':'llama_json_schema'})
  return result
 base.agent_constrain_request=constrain
 def cloud_ready():
  if not base.CONF.get('controlled_gateway_key'):return False
  with base.db_lock,contextlib.closing(base.connect()) as db:count=db.execute("SELECT count(*) FROM events WHERE kind='cloud_attempt' AND created>=?",(base.now()[:10],)).fetchone()[0]
  return count<int(base.CONF.get('cloud_daily_limit',100))
 def release(expected=None):
  with lock:
   if lease and (expected is None or hmac.compare_digest(str(expected),lease['key'])):
    if lease.get('inflight',0):lease['ending']=True
    else:lease.clear();base.gate.release()
 def reap():
  while True:
   time.sleep(2)
   with lock:
    expired=bool(lease and time.monotonic()>lease['expires'])
    for key in [key for key,stamp in cancelled.items() if time.monotonic()-stamp>600]:cancelled.pop(key,None)
   if expired:release()
 threading.Thread(target=reap,daemon=True).start()
 class Internal(http.server.BaseHTTPRequestHandler):
  def log_message(self,*args):pass
  def send_json(self,value,status=200):
   if getattr(self,'_model_streaming',False):
    self.wfile.write(('data: '+json.dumps({'error':value.get('error') or {'message':value.get('code','model_stream_error'),'code':value.get('code','model_stream_error')}},ensure_ascii=False)+'\n\ndata: [DONE]\n\n').encode());self.wfile.flush();return
   data=json.dumps(value,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
  def do_POST(self):
   self._model_streaming=False
   try:
    if not hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+token):return self.send_json({'code':'unauthorized'},401)
    size=int(self.headers.get('Content-Length','0'))
    if not 0<size<=MAX_BODY:raise ValueError('body_limit')
    body=json.loads(self.rfile.read(size));route=urllib.parse.urlsplit(self.path).path
    if route=='/hooks/check':
     if body.get('stage') not in ('UserPromptSubmit','PreToolUse','PostToolUse') or not re.fullmatch(r'[a-f0-9-]{36}',body.get('run','')):raise ValueError('invalid_hook')
     text=body.get('content');text=text if isinstance(text,str) else json.dumps(text,ensure_ascii=False)
     if len(text)>8192:raise ValueError('hook_content_budget')
     start=time.perf_counter();result=controlled.input_policy.check(text)
     if not result['blocked']:
      result_semantic=base.http_json('http://127.0.0.1:17792/moderate',{'messages':[{'role':'user','content':text}]},timeout=8)
      if result_semantic.get('label')!='Safe':result={'blocked':True,'reason_code':'unsafe_tool_content'}
     result={'verdict':'block' if result['blocked'] else 'allow','mode':'policy_bridge','native':False,'policy':controlled.input_policy.VERSION,'stage':body['stage'],'elapsed_ms':(time.perf_counter()-start)*1000}
     base.event('agent_hook',body['run'],result)
     return self.send_json(result)
    if route=='/agent/start':
     run=body.get('run','');model=body.get('model');scope=body.get('scope','local');decision_engine=engine_id(body.get('decision_engine'))
     if not re.fullmatch(r'[a-f0-9-]{36}',run) or model not in ('auto','standard','cloud') or scope not in ('local','hybrid'):raise ValueError('invalid_request')
     if model=='cloud' and scope!='hybrid':return self.send_json({'code':'cloud_scope_required'},403)
     if base.benchmark_active():return self.send_json({'code':'benchmark_busy'},429)
     with lock:
      if run in cancelled:return self.send_json({'code':'cancelled'},409)
      if not base.gate.acquire(blocking=False):return self.send_json({'code':'device_busy'},409)
     try:
      decision=router.decide(model,scope,body.get('context'),body.get('owner',run),body.get('project','demo'),base.healthy(17777),cloud_ready() if scope=='hybrid' else False,decision_engine)
      selected=decision['recommended']
      with lock:
       if run in cancelled:raise ValueError('cancelled')
       lease.update(key=secrets.token_urlsafe(32),run=run,selected=selected,scope=scope,decision=decision,expires=time.monotonic()+330,inflight=0,ending=False,output=output_spec(body.get('output')),telemetry=[])
      base.event('agent_decision',run,decision)
      base.event('agent_start',run,{'selected':selected,'mode':model,'scope':scope,'decision_id':decision['decision_id']})
      return self.send_json({'lease':lease['key'],'selected':selected,'reason':decision['reason'],'decision':decision})
     except Exception:
      with lock:lease.clear()
      base.gate.release();raise
    if route=='/agent/telemetry':
     with lock:
      if not lease or lease.get('run')!=body.get('run') or not hmac.compare_digest(str(body.get('lease','')),lease['key']):return self.send_json({'code':'lease_invalid'},403)
      after=body.get('after',0)
      if not isinstance(after,int) or after<0:raise ValueError('invalid_request')
      records=[e for e in lease['telemetry'] if e['seq']>after]
     return self.send_json({'events':records})
    if route=='/agent/end':
     expected=body.get('lease','');run=body.get('run','')
     with lock:
      if re.fullmatch(r'[a-f0-9-]{36}',run):
       cancelled[run]=time.monotonic()
       if lease.get('run')==run:expected=lease['key']
     release(expected);return self.send_json({'ok':True})
    if route=='/v1/chat/completions':
     with lock:current=dict(lease)
     if not current or current.get('ending') or current['expires']<time.monotonic() or not hmac.compare_digest(self.headers.get('X-Orion-Lease',''),current['key']):return self.send_json({'code':'lease_invalid'},403)
     validate_dispatch(current['scope'],current['selected'],body.get('model'))
     # The caller cannot widen the scope stored in the admission lease.
     if 'scope' in body and body['scope']!=current['scope']:raise ValueError('scope_mismatch')
     if 'decision_engine' in body and body['decision_engine']!=current['decision']['decision_engine']:raise ValueError('decision_engine_mismatch')
     messages=guard_messages(body.get('messages'));selected=current['selected'];rid=current['run']
     for tool in body.get('tools',[]):
      if tool.get('type')!='function' or tool.get('function',{}).get('name') not in TOOLS:raise ValueError('agent_tool_denied')
     if selected=='cloud':
      with base.db_lock,contextlib.closing(base.connect()) as db:count=db.execute("SELECT count(*) FROM events WHERE kind='cloud_attempt' AND created>=?",(base.now()[:10],)).fetchone()[0]
      if count>=int(base.CONF.get('cloud_daily_limit',100)):return self.send_json({'code':'cloud_limit'},429)
     decision={**current['decision'],'difficulty_key':'B'}
     spec=current['output'];tools=body.get('tools',[])
     protocol_messages=tool_protocol_request(body['messages'],tools,spec)
     def record(kind,data):
      item={'type':kind,'data':data}
      with lock:
       if lease and lease['key']==current['key']:
        item['seq']=len(lease['telemetry'])+1;lease['telemetry'].append(item)
      base.event('agent_protocol',rid,item)
     with lock:
      if not lease or lease['key']!=current['key'] or lease['ending']:return self.send_json({'code':'lease_invalid'},403)
      lease['inflight']+=1
     try:
      self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Connection','close');self.end_headers();self.close_connection=True
      self._model_streaming=True;disconnected=False;aggregate={}
      def emit(delta,finish=None):
       nonlocal disconnected
       if disconnected:return
       chunk={'id':'agent-'+rid,'object':'chat.completion.chunk','created':int(time.time()),'model':selected,'choices':[{'index':0,'delta':delta,'finish_reason':finish}]}
       if finish:chunk['usage']=aggregate
       try:self.wfile.write(('data: '+json.dumps(chunk,ensure_ascii=False)+'\n\n').encode());self.wfile.flush()
       except (BrokenPipeError,ConnectionResetError):disconnected=True
      for attempt in range(2):
       with lock:
        if not lease or lease['key']!=current['key'] or lease['ending'] or lease['expires']<time.monotonic():raise ValueError('lease_invalid')
       validate_dispatch(current['scope'],selected,body.get('model'))
       if selected=='cloud' and not cloud_ready():raise ValueError('cloud_limit')
       cache_messages=base.inspect_messages([m for m in protocol_messages if m['role'] in ('user','assistant')])[0]
       controlled.remember(cache_messages,decision,rid)
       request={'messages':protocol_messages,'stream':True,'stream_options':{'include_usage':True},'temperature':0,'model':controlled.REGISTRY[selected]['logical'],'max_tokens':1024}
       if selected=='cloud':request['thinking']={'type':'disabled'}
       else:request['chat_template_kwargs']={'enable_thinking':False}
       ticket=None
       if selected=='standard' and hasattr(base,'REGISTRY'):
        ticket=contracts.register(base.REGISTRY[selected]['model'],protocol_messages,generation_schema(tools,spec,final_only=attempt>0),rid)
       req=urllib.request.Request(base.GATEWAY,data=json.dumps(request,ensure_ascii=False).encode(),headers={'Authorization':'Bearer '+base.CONF['controlled_gateway_key'],'Content-Type':'application/json',GATEWAY_METADATA_HEADER:json.dumps({'route':selected,'decision_id':decision['decision_id'],'agent_run':rid,'scope':current['scope'],'modality':'text','difficulty':'B'})})
       decoder=ProtocolStream(spec,tools,after_tool=bool(body['messages'] and body['messages'][-1].get('role')=='tool'));usage={};gateway_id='';upstream_done=False;stop_reason=None
       base.event('agent_dispatch',rid,{'selected':selected,'scope':current['scope'],'decision_id':decision['decision_id'],'protocol':PROTOCOL_VERSION,'attempt':attempt})
       dispatch_started=time.perf_counter()
       try:
        with urllib.request.urlopen(req,timeout=180) as response:
         gateway_id=response.headers.get('X-Request-ID','')
         base.event('agent_gateway',rid,{'request_id':gateway_id,'selected':selected,'scope':current['scope'],'decision_id':decision['decision_id'],'attempt':attempt})
         if ticket and not contracts.applied(ticket):raise ValueError('generation_contract_missing')
         for line in response:
          if not line.startswith(b'data:'):continue
          data=line[5:].strip()
          if data==b'[DONE]':upstream_done=True;break
          part=json.loads(data)
          if part.get('error'):raise ValueError('model_stream_error')
          if part.get('usage'):usage=part['usage']
          for choice in part.get('choices',[]):
           content=choice.get('delta',{}).get('content') or ''
           if content:
            visible=decoder.feed(content)
            if visible:emit({'content':visible})
           if choice.get('finish_reason'):stop_reason=choice['finish_reason'];upstream_done=True
        if not upstream_done:raise ValueError('model_stream_incomplete')
        if stop_reason=='length':raise ValueError('model_output_truncated')
        if stop_reason not in (None,'stop','tool_calls'):raise ValueError('model_output_refused')
        if ticket and not contracts.applied(ticket):raise ValueError('generation_contract_missing')
        delta,finish=decoder.finish(final_only=attempt>0)
       except FinalFormatError as error:
        record('protocol_attempt',{'version':PROTOCOL_VERSION,'attempt':attempt,'valid':False,'code':str(error)})
        if attempt or decoder.preview or len(decoder.raw)>6000:raise
        if controlled.input_policy.check(decoder.raw)['blocked']:raise ValueError('unsafe_format_draft')
        record('format_repair',{'state':'started','code':str(error),'attempt':1})
        protocol_messages=[{'role':'system','content':'只纠正最终回答的协议和格式，不改变事实，不补造字段值，不调用任何工具。原内容不足时停止，不编造。仅返回一个JSON对象。JSON格式必须是{"type":"final","format":"json","data":{原有业务字段和值}}；文本格式必须是{"type":"final","format":"text","content":"原有回答"}。若草稿本身是业务JSON，只给它增加外层type/format/data，保留原有全部字段和值，不增加result层、不删除字段、不输出解释。当前可用工具：[]。固定输出要求：'+json.dumps(spec,ensure_ascii=False)},
         {'role':'user','content':json.dumps({'untrusted_final_draft':decoder.raw,'validation_error':str(error),'required_output':spec},ensure_ascii=False)}]
        continue
       except ValueError as error:
        record('protocol_attempt',{'version':PROTOCOL_VERSION,'attempt':attempt,'valid':False,'code':str(error)})
        raise
       except urllib.error.HTTPError as error:
        elapsed_ms=round((time.perf_counter()-dispatch_started)*1000)
        record('protocol_attempt',{'version':PROTOCOL_VERSION,'attempt':attempt,'valid':False,'code':'gateway_'+str(error.code),'failure_stage':'upstream','elapsed_ms':elapsed_ms})
        base.event('agent_transport_error',rid,{'selected':selected,'scope':current['scope'],'decision_id':decision['decision_id'],'attempt':attempt,'http_status':error.code,'elapsed_ms':elapsed_ms,'request_id':error.headers.get('X-Request-ID',''),'automatic_retry':False})
        raise
       finally:
        if ticket:contracts.remove(ticket)
        base.event('agent_usage',rid,{'selected':selected,'scope':current['scope'],'request_id':gateway_id,'usage':usage,'attempt':attempt})
        for key in ('prompt_tokens','completion_tokens','total_tokens'):
         if isinstance(usage.get(key),int):aggregate[key]=aggregate.get(key,0)+usage[key]
       record('protocol_attempt',{'version':PROTOCOL_VERSION,'attempt':attempt,'valid':True,'canonical':json.loads(decoder.raw).get('type') in ('tool','final'),'constrained':bool(ticket),'kind':'tool' if finish=='tool_calls' else 'final','output':spec['format']})
       if attempt:record('format_repair',{'state':'completed','attempt':attempt})
       if delta.get('tool_calls'):emit(delta)
       elif delta['content'][len(decoder.preview):]:emit({'content':delta['content'][len(decoder.preview):]})
       emit({},finish)
       if not disconnected:
        try:self.wfile.write(b'data: [DONE]\n\n');self.wfile.flush()
        except (BrokenPipeError,ConnectionResetError):pass
       break
     finally:
      with lock:
       if lease and lease['key']==current['key']:lease['inflight']-=1;ending=lease['ending']
       else:ending=False
      if ending:release(current['key'])
     return
    return self.send_json({'code':'not_found'},404)
   except urllib.error.HTTPError as e:
    try:upstream=json.loads(e.read(8192));details=upstream.get('error',{});code=details.get('code','gateway_'+str(e.code));message=controlled.input_policy.redact(str(details.get('message','')))[:300]
    except Exception:code='gateway_'+str(e.code);message=''
    if not re.fullmatch(r'[a-z_0-9]+',str(code)):code='gateway_'+str(e.code)
    base.event('agent_gateway_error',body.get('run') or lease.get('run','agent'),{'code':code,'http_status':e.code,'message':message,'request_id':e.headers.get('X-Request-ID','')})
    return self.send_json({'error':{'message':'AI Gateway or model refused the request: '+str(code),'type':'gateway_error','code':code},'code':code},e.code)
   except ValueError as e:return self.send_json({'code':str(e) if re.fullmatch(r'[a-z_]+',str(e)) else 'invalid_request'},400)
   except (BrokenPipeError,ConnectionResetError):pass
   except Exception:return self.send_json({'code':'bridge_unavailable'},503)
 server=http.server.ThreadingHTTPServer(('127.0.0.1',internal_port),Internal)
 threading.Thread(target=server.serve_forever,daemon=True).start()
 def owner(handler):return device_identity(handler.headers,token,handler.client_address[0])
 def principal_headers(handler):return {'Authorization':'Bearer '+token,'X-Orion-Owner':owner(handler),'X-Orion-Legacy-Owner':hmac.new(token.encode(),('device:'+handler.client_address[0]).encode(),hashlib.sha256).hexdigest()}
 def node_call(handler,route,body=None,attest=False):
  headers={**principal_headers(handler),'Content-Type':'application/json'}
  if attest:headers['X-Orion-Attested']='chat-completed'
  req=urllib.request.Request('http://127.0.0.1:17795'+route,data=json.dumps(body).encode() if body is not None else None,headers=headers)
  with urllib.request.urlopen(req,timeout=15) as response:return json.load(response)
 def prepare_chat(handler,p):
  cid=p.get('conversation_id');tid=p.get('turn_id')
  if not cid and not tid:return None
  if not all(isinstance(x,str) and re.fullmatch(r'(?:[a-f0-9]{32}|[a-f0-9-]{36})',x) for x in (cid,tid)):raise ValueError('invalid_conversation')
  node_call(handler,'/conversations',{'id':cid})
  record=node_call(handler,'/conversations/'+cid)
  return completed_chat_context(record,base.text_of(p['messages'][-1]['content']),bool(p.get('documents')))
 def complete_chat(handler,p,prompt,answer,feedback=None):
  if not p.get('conversation_id'):return True
  turn={'id':p['turn_id'],'engine':'chat','prompt':prompt,'answer':answer,'created':controlled.now(),'snapshot':{'mode':'agent','execution':'answer','access':'read','model':p.get('mode','auto'),'scope':p.get('scope','local'),'decisionEngine':engine_id(p.get('decision_engine')),'project':p.get('project'),'files':[]}}
  if feedback is not None:turn['feedback']={k:feedback[k] for k in ('request_id','gateway_request_id','mode','scope','selected','model','actual_upstream_model','decision','decision_engine','decision_ms','elapsed_ms','stages','output_policy','fallback','finish_reason') if k in feedback}
  node_call(handler,'/conversations/'+p['conversation_id']+'/complete',turn,True);return True
 controlled.workspace_prepare=prepare_chat;controlled.workspace_complete=complete_chat
 def proxy(handler,body=None):
  route=urllib.parse.urlsplit(handler.path).path.removeprefix('/api/agent')
  if not re.fullmatch(r'/(?:health|files|experiences/output|projects(?:/[a-z0-9_-]{1,40}(?:/(?:files|read|write|mkdir|preview|import|update|export))?)?|conversations(?:/[a-f0-9-]{32,36})?|runs(?:/[a-f0-9-]{36}(?:/(?:approve|cancel|events))?)?)',route):return handler.send_json({'code':'not_found'},404)
  if not handler.authenticated():return handler.send_json({'code':'session_required'},401)
  try:
   if route.endswith('/events'):
    if body is not None:return handler.send_json({'code':'method_not_allowed'},405)
    request=urllib.request.Request('http://127.0.0.1:17795'+route,headers=principal_headers(handler))
    with urllib.request.urlopen(request,timeout=25) as response:
     handler.send_response(200);handler.send_header('Content-Type','application/x-ndjson; charset=utf-8');handler.send_header('Cache-Control','no-store');handler.send_header('Connection','close');handler.send_header('X-Accel-Buffering','no');handler.end_headers();handler.close_connection=True
     for line in response:handler.wfile.write(line);handler.wfile.flush()
    return
   return handler.send_json(node_call(handler,route,body))
  except (BrokenPipeError,ConnectionResetError):return
  except urllib.error.HTTPError as e:return handler.send_json(json.load(e),e.code)
  except Exception:return handler.send_json({'code':'agent_unavailable'},503)
 proxy.identity_cookie=lambda handler:device_cookie(handler.headers,token)
 proxy.owner=owner
 proxy.internal_server=server
 return proxy
