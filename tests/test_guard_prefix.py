"""Speculation only prepares a token prefix; every request still generates a verdict."""
import importlib.util, io, json, os, pathlib, sys, threading, unittest
from unittest.mock import Mock, patch


class GuardPrefixTests(unittest.TestCase):
 def test_warm_never_supplies_a_verdict_or_reuses_a_different_transcript(self):
  tokenizer=Mock()
  tokenizer.apply_chat_template.side_effect=lambda rows,**kw: '|'.join(m['role']+':'+m['content'] for m in rows)+'|judge'
  tokenizer.side_effect=lambda text,**kw:{'input_ids':Mock(shape=(1,len(text)))} if kw else {'input_ids':list(text)}
  transformers=Mock();transformers.AutoTokenizer.from_pretrained.return_value=tokenizer
  file=pathlib.Path(__file__).resolve().parents[1]/'services/o6n-bridge/guard_server.py'
  spec=importlib.util.spec_from_file_location('fixture_guard',file);guard=importlib.util.module_from_spec(spec)
  with patch.dict(os.environ,{'O6N_GUARD_BACKEND':'llama-q8'}),patch.dict(sys.modules,{'torch':Mock(),'transformers':transformers}):
   spec.loader.exec_module(guard)
  calls=[]
  def completion(req,**kwargs):
   payload=json.loads(req.data);calls.append(payload)
   output='Safety: Unsafe' if 'danger' in payload['prompt'] else 'Safety: Safe'
   return io.BytesIO(json.dumps({'content':output,'tokens_predicted':4}).encode())
  q=[{'role':'user','content':'first'}];answer='a'*400
  with patch.object(guard,'rss',return_value={}),patch.object(guard.urllib.request,'urlopen',side_effect=completion):
   self.assertEqual(guard.predict(q)['label'],'Safe')
   guard.warm_prefix(q,answer);self.assertEqual(guard.warm_length,192)
   self.assertEqual(calls[-1]['n_predict'],1)
   guard.warm_prefix(q,'b'*400);guard.warm_prefix([{'role':'user','content':'edited'}],answer)
   with guard.gate:guard.warm_prefix(q,answer)
   self.assertEqual(len(calls),2)
   follow=[*q,{'role':'assistant','content':answer},{'role':'user','content':'danger'}]
   self.assertEqual(guard.predict(follow)['label'],'Unsafe')
   self.assertTrue(calls[-1]['prompt'].startswith(calls[-2]['prompt']))
   self.assertEqual(calls[-1]['n_predict'],16)
   self.assertIsNone(guard.warm_context)
