import io,json,pathlib,sys,tempfile,types,unittest
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'services/o6n-bridge'))
import agent_extension

class ExperienceFeedbackTests(unittest.TestCase):
 def test_selftest_proxy_requires_session_and_only_forwards_the_fixed_route(self):
  with tempfile.TemporaryDirectory() as tmp:
   controlled=types.SimpleNamespace(now=lambda:'2026-10-22T00:00:00Z');proxy=agent_extension.install(types.SimpleNamespace(),controlled,internal_port=0,state_root=pathlib.Path(tmp))
   handler=types.SimpleNamespace(path='/api/agent/experiences/output',headers={},client_address=('fixture',0),authenticated=lambda:False,send_json=lambda body,status=200:(status,body))
   calls=[]
   def upstream(request,**kwargs):
    calls.append(request);return io.BytesIO(b'{"passed":true}')
   try:
    with patch.object(agent_extension.urllib.request,'urlopen',upstream):
     self.assertEqual(proxy(handler,{})[0],401);self.assertEqual(calls,[])
     handler.authenticated=lambda:True
     self.assertEqual(proxy(handler,{})[1],{'passed':True});self.assertEqual(calls[0].full_url,'http://127.0.0.1:17795/experiences/output')
     self.assertEqual(json.loads(calls[0].data),{});self.assertEqual(len(calls[0].get_header('X-orion-owner')),64)
     handler.path='/api/agent/experiences/arbitrary';self.assertEqual(proxy(handler,{})[0],404);self.assertEqual(len(calls),1)
   finally:proxy.internal_server.shutdown();proxy.internal_server.server_close()

 def test_completed_chat_keeps_only_feedback_fields_and_never_adds_feedback_to_context(self):
  with tempfile.TemporaryDirectory() as tmp:
   controlled=types.SimpleNamespace(now=lambda:'2026-10-22T00:00:00Z');proxy=agent_extension.install(types.SimpleNamespace(),controlled,internal_port=0,state_root=pathlib.Path(tmp));calls=[]
   handler=types.SimpleNamespace(headers={},client_address=('fixture',0))
   def upstream(request,**kwargs):calls.append(request);return io.BytesIO(b'{"ok":true}')
   try:
    with patch.object(agent_extension.urllib.request,'urlopen',upstream):
     controlled.workspace_complete(handler,{'conversation_id':'a'*32,'turn_id':'b'*32},'合成问题','合成回答',{'actual_upstream_model':'physical-4b','decision':{'reason':'简单任务'},'stages':[{'stage':'input_passed'}],'output_policy':'stream_no_output_review','answer':'must not duplicate','unknown':'must not persist'})
     body=json.loads(calls[0].data);self.assertEqual(body['feedback']['actual_upstream_model'],'physical-4b');self.assertNotIn('answer',body['feedback']);self.assertNotIn('unknown',body['feedback']);self.assertEqual(body['prompt'],'合成问题');self.assertEqual(body['answer'],'合成回答');self.assertEqual(calls[0].get_header('X-orion-attested'),'chat-completed')
   finally:proxy.internal_server.shutdown();proxy.internal_server.server_close()

if __name__=='__main__':unittest.main()
