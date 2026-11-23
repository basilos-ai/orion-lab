import json,pathlib,sys,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'services/o6n-bridge'))
from answer_models import AnswerModels,LOCAL_MODELS,prompt_fits,merge_image_context
from vision_review import VisionReviews

class AnswerTests(unittest.TestCase):
 def test_preparation_uses_fixed_engine_and_preserves_other_answers(self):
  class Engines:
   calls=[]
   def prepare(self,engine,progress):self.calls.append(engine);return 14
  e=Engines();commands=[];m=AnswerModels(e,lambda p:True,runner=lambda args,**kw:commands.append(args))
  self.assertEqual(m.prepare('small'),14);self.assertEqual(e.calls,['qwen35-4b-houmo'])
  m.prepare('tiny');self.assertEqual(e.calls[-1],'qwen35-2b-houmo')
  self.assertEqual(m.prepare('standard'),0);self.assertEqual(m.prepare('vision'),0);self.assertEqual(commands,[])
 def test_context_counts_real_template_and_reserved_output(self):
  calls=[]
  def http(url,payload,**kw):
   calls.append((url,payload));return {'prompt':'template'} if url.endswith('apply-template') else {'tokens':[1]*4000}
  self.assertFalse(prompt_fits(http,LOCAL_MODELS['small'],[{'role':'user','content':'x'}],128))
  self.assertEqual(calls[1][1]['content'],'template')
 def test_followup_retains_only_matching_recent_images_and_authoritative_text(self):
  def user(image):return {'role':'user','content':[{'type':'text','text':'图片'},{'type':'image_url','image_url':{'url':image}}]}
  answer={'role':'assistant','content':'描述'};last={'role':'user','content':'圆形是什么颜色？'}
  prior=[{'role':'user','content':'图片'},answer]
  sent=[user('old'),answer,user('recent'),answer,last]
  merged=merge_image_context(prior,sent);self.assertEqual(merged[0]['content'][1]['image_url']['url'],'recent');self.assertEqual(merged[-1],last);self.assertEqual(merged[1],answer)
  bad=[{'role':'user','content':[{'type':'text','text':'别的内容'},{'type':'image_url','image_url':{'url':'unrelated'}}]},answer,last]
  self.assertEqual(merge_image_context(prior,bad),[*prior,last]);self.assertIsInstance(prior[0]['content'],str)

class VisionTests(unittest.TestCase):
 def setUp(self):
  self.stamp=0;self.raw='{"visible_text":"","description":"红色方块","visual_risk":"none","evidence":""}';self.finish='stop';self.calls=[]
  def http(url,payload,**kw):
   self.calls.append((url,payload));return {'choices':[{'message':{'content':self.raw},'finish_reason':self.finish}]}
  self.review=VisionReviews(http,lambda m:json.dumps(m,sort_keys=True),clock=lambda:self.stamp)
  self.messages=[{'role':'user','content':[{'type':'text','text':'x'},{'type':'image_url','image_url':{'url':'data:image/png;base64,fixture'}}]}]
 def test_exact_binding_expiry_and_fixed_local_screen(self):
  self.assertIsNone(self.review.get(self.messages));result=self.review.prepare(self.messages)
  self.assertEqual(result['risk'],'safe');self.assertEqual(self.review.get(self.messages),result)
  self.assertIsNone(self.review.get([*self.messages,{'role':'user','content':'different'}]))
  self.assertEqual(self.calls[0][0],'http://127.0.0.1:17777/v1/chat/completions')
  self.assertNotIn('x',self.calls[0][1]['messages'][1]['content'][0].values())
  self.stamp=91;self.assertIsNone(self.review.get(self.messages))
 def test_malformed_duplicate_truncated_and_uncertain_close(self):
  for raw in ['{}','{"risk":"safe","risk":"harmful","description":"","visible_text":""}','```json\n{}\n```','{"risk":"allow","description":"","visible_text":""}']:
   self.raw=raw;self.assertEqual(self.review.prepare(self.messages)['risk'],'uncertain')
  self.raw='{"visible_text":"","description":"红色方块","visual_risk":"none","evidence":""}';self.finish='length';self.assertEqual(self.review.prepare(self.messages)['risk'],'uncertain')
 def test_sensitive_is_retained_for_gateway_block_not_changed_to_safe(self):
  self.raw='{"visible_text":"synthetic","description":"保密文档截图","visual_risk":"confidential_document","evidence":"可见保密正文"}'
  self.assertEqual(self.review.prepare(self.messages)['risk'],'sensitive')

if __name__=='__main__':unittest.main()
