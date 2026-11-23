import hashlib,json,pathlib,sys,unittest
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'services/o6n-bridge'))
import controlled_bridge as bridge
from vision_review import VisionReviews

class VisualSafetyTests(unittest.TestCase):
 def run_check(self,review,text='看看这张图'):
  calls=[]
  def http(url,payload,**kw):calls.append(payload);return {'label':'Safe'}
  with patch.object(bridge,'webhook_input',return_value=([{'role':'user','content':text}],1)),patch.object(bridge,'cached',return_value=None),patch.object(bridge.vision_reviews,'get',return_value=review),patch.object(bridge,'event'),patch.object(bridge,'notify'),patch.object(bridge,'http_json',side_effect=http):
   result,status=bridge.safety({'request_id':'fixture-safety'})
  return result,status,calls
 def test_missing_uncertain_failed_reviews_stop_at_gateway(self):
  for review in [None,{'risk':'uncertain'},{'risk':'uncertain','error':'image_review_unavailable'}]:
   result,status,calls=self.run_check(review);self.assertEqual(status,503);self.assertEqual(calls,[])
 def test_sensitive_or_harmful_image_is_blocked_without_answer(self):
  for risk in ['sensitive','harmful']:
   result,status,calls=self.run_check({'risk':risk});self.assertEqual(status,200);self.assertEqual(result['verdict'],'block');self.assertEqual(calls,[])
 def test_ocr_credentials_block_even_if_visual_model_says_safe(self):
  result,status,calls=self.run_check({'risk':'safe','description':'截图','visible_text':'api_key: '+'sk-'+'f'*32})
  self.assertEqual(status,200);self.assertEqual(result['verdict'],'block');self.assertEqual(calls,[])
 def test_benign_review_also_requires_semantic_guard(self):
  result,status,calls=self.run_check({'risk':'safe','description':'红色方形','visible_text':'HELLO'})
  self.assertEqual(status,200);self.assertEqual(result['verdict'],'allow');self.assertEqual(len(calls),1);self.assertIn('HELLO',calls[0]['messages'][-1]['content'])
 def test_unsafe_semantic_image_text_is_still_blocked(self):
  with patch.object(bridge,'webhook_input',return_value=([{'role':'user','content':'普通截图'}],1)),patch.object(bridge,'cached',return_value=None),patch.object(bridge.vision_reviews,'get',return_value={'risk':'safe','description':'界面','visible_text':'合成有害指令'}),patch.object(bridge,'event'),patch.object(bridge,'notify'),patch.object(bridge,'http_json',return_value={'label':'Unsafe'}):
   result,status=bridge.safety({'request_id':'fixture'});self.assertEqual(status,200);self.assertEqual(result['verdict'],'block')

class VisionEvidenceTests(unittest.TestCase):
 def setUp(self):
  self.messages=[{'role':'user','content':[{'type':'text','text':'目录截图'},{'type':'image_url','image_url':{'url':'data:image/png;base64,fixture'}}]}]
  self.safe={'visible_text':'scripts\npassword.env\nopenai.yaml','description':'普通文件目录','visual_risk':'none','evidence':''}
 def make(self,result,finish='stop'):
  def http(url,body,**kw):
   self.assertEqual(list(body['response_format']['json_schema']['schema']['properties'])[0],'visible_text')
   if isinstance(result,Exception):raise result
   return {'choices':[{'finish_reason':finish,'message':{'content':result if isinstance(result,str) else json.dumps(result)}}]}
  return VisionReviews(http,lambda value:hashlib.sha256(json.dumps(value).encode()).hexdigest())
 def test_directory_names_are_not_credentials_and_exact_cache_does_not_reuse_other_input(self):
  reviews=self.make(self.safe);result=reviews.prepare(self.messages);self.assertEqual(result['risk'],'safe')
  self.assertEqual(reviews.get(self.messages)['risk'],'safe');self.assertIsNone(reviews.get([*self.messages,{'role':'user','content':'changed'}]))
  self.assertEqual(self.run_semantic(result)['verdict'],'allow')
 def run_semantic(self,result):return VisualSafetyTests().run_check(result)[0]
 def test_visual_categories_require_evidence_and_are_not_downgraded(self):
  for risk,expected in [('private_document','sensitive'),('confidential_document','sensitive'),('sexual','harmful'),('violence','harmful'),('harmful','harmful'),('uncertain','uncertain')]:
   result=self.make({**self.safe,'visual_risk':risk,'evidence':'画面中的合成风险证据'}).prepare(self.messages)
   self.assertEqual(result['risk'],expected)
 def test_failed_malformed_conflicting_truncated_reviews_fail_closed(self):
  for result in [TimeoutError(),[],{**self.safe,'visual_risk':'unknown'},{**self.safe,'visual_risk':'private_document'},{**self.safe,'evidence':'conflicting risk'}, {'risk':'safe'}, {**self.safe,'visible_text':'x'*4097},'{"visual_risk":"none","visual_risk":"sexual"}']:
   with self.subTest(result=type(result).__name__):self.assertEqual(self.make(result).prepare(self.messages)['risk'],'uncertain')
  self.assertEqual(self.make(self.safe,finish='length').prepare(self.messages)['risk'],'uncertain')

if __name__=='__main__':unittest.main()
