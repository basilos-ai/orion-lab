import importlib.util,pathlib,unittest,sys
path=pathlib.Path(__file__).resolve().parents[1]/'services/o6n-bridge/agent_extension.py'
sys.path.insert(0,str(path.parent))
spec=importlib.util.spec_from_file_location('agent_extension',path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class AgentBridgeTests(unittest.TestCase):
 def test_persistent_device_identity_survives_address_change_and_rejects_forgery(self):
  value=module.device_cookie({},'fixture-token');headers={'Cookie':value.split(';')[0]}
  self.assertEqual(module.device_identity(headers,'fixture-token','old-address'),module.device_identity(headers,'fixture-token','new-address'))
  self.assertIsNone(module.device_cookie(headers,'fixture-token'))
  forged={'Cookie':headers['Cookie'][:-1]+('0' if headers['Cookie'][-1]!='0' else '1')}
  self.assertNotEqual(module.device_identity(headers,'fixture-token','old-address'),module.device_identity(forged,'fixture-token','old-address'))
  self.assertIsNotNone(module.device_cookie(forged,'fixture-token'))
 def test_directory_tool_requires_listed_schema_and_never_enables_shell(self):
  import json
  tool=[{'type':'function','function':{'name':'create_directory','parameters':{'type':'object','properties':{'path':{'type':'string'}},'required':['path']}}}]
  raw=json.dumps({'type':'tool','name':'create_directory','arguments':{'path':'src'}})
  self.assertEqual(module.tool_protocol_response(raw,tools=tool)[1],'tool_calls')
  with self.assertRaises(ValueError):module.tool_protocol_response(raw,tools=[{'function':{'name':'read_file'}}])
 def test_tool_result_is_reviewed(self):
  messages=[{'role':'system','content':'Agent'},{'role':'user','content':'read'},{'role':'assistant','content':None,'tool_calls':[{'function':{'name':'read_file','arguments':'{}'}}]},{'role':'tool','content':'untrusted text','tool_call_id':'c'}]
  normalized=module.guard_messages(messages)
  self.assertIn('untrusted text',normalized[-1]['content']);self.assertTrue(any('read_file' in m['content'] for m in normalized))
 def test_no_silent_truncation_or_unlisted_tool(self):
  for messages in [[{'role':'tool','content':'x'*8193}],[{'role':'assistant','tool_calls':[{'function':{'name':'bash','arguments':'{}'}}]}],[{'role':'user','content':[{'type':'image_url'}]}]]:
   with self.assertRaises(ValueError):module.guard_messages(messages)
 def test_openai_text_parts_preserved_for_guard(self):
  normalized=module.guard_messages([{'role':'user','content':[{'type':'text','text':'hello'},{'type':'text','text':'world'}]}])
  self.assertIn('hello\nworld',normalized[0]['content'])
 def test_text_tool_protocol_is_strict_and_does_not_offer_shell(self):
  delta,finish=module.tool_protocol_response('{"tool":"read_file","arguments":{"path":"README.md"}}')
  self.assertEqual(finish,'tool_calls');self.assertEqual(delta['tool_calls'][0]['function']['name'],'read_file')
  for response in ['plain text','{"tool":"bash","arguments":{}}','{"tool":"write_file","arguments":{},"answer":"x"}']:
   with self.assertRaises(ValueError):module.tool_protocol_response(response)
  self.assertEqual(module.tool_protocol_response('{"answer":"done"}')[1],'stop')
 def test_answer_stream_decodes_every_character_boundary(self):
  text='中文换行\n含引号"与反斜线\\以及表情😀'
  import json
  raw=json.dumps({'answer':text},ensure_ascii=True)
  parser=module.ProtocolStream();parts=[]
  for ch in raw:parts.append(parser.feed(ch))
  self.assertEqual(''.join(parts),text);self.assertEqual(parser.finish(),({'content':text},'stop'))
  self.assertGreater(sum(bool(p) for p in parts),3)
 def test_tool_stream_never_publishes_or_executes_partial_arguments(self):
  parser=module.ProtocolStream()
  raw='{"tool":"write_file","arguments":{"path":"demo.py","content":"print(1)"}}'
  self.assertEqual(''.join(parser.feed(ch) for ch in raw),'')
  delta,finish=parser.finish();self.assertEqual(finish,'tool_calls');self.assertEqual(delta['tool_calls'][0]['function']['name'],'write_file')
 def test_stream_invalid_or_extra_tool_keys_fail_closed(self):
  for raw in ['{"answer":"incomplete','{"answer":"visible","tool":"write_file"}','{"tool":"bash","arguments":{}}']:
   parser=module.ProtocolStream();parser.feed(raw)
   with self.assertRaises(ValueError):parser.finish()
  parser=module.ProtocolStream()
  with self.assertRaises(ValueError):parser.feed('x'*32769)
if __name__=='__main__':unittest.main()
