import io,json,os,pathlib,sys,tempfile,time,unittest,zipfile
from unittest.mock import Mock,patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'services/o6n-bridge'))
from document_extract import extract
from document_review import Documents,DocumentError,DEFAULTS,MODELS,configuration,MARKER,CHOICES
from document_samples import pdf,docx

class DocumentTests(unittest.TestCase):
 def test_completed_long_document_context_survives_followups_without_truncation(self):
  from agent_extension import completed_chat_context
  original='[[ORION_DOCUMENT:'+'a'*32+':'+'b'*64+']]\n'+'公开材料'*1200
  record={'context':[],'turns':[{'prompt':original,'answer':'合成摘要'},{'prompt':'收入是多少','answer':'42'}]}
  result=completed_chat_context(record,'继续提问')
  self.assertEqual(result[0]['content'],original);self.assertEqual(len(result),4)
  self.assertEqual(completed_chat_context(record,'新附件',True),[])
  with self.assertRaises(ValueError):completed_chat_context(record,'x'*22000)
 def test_replacement_upload_does_not_reuse_old_document_ids(self):
  from agent_extension import completed_chat_context
  original='[[ORION_DOCUMENT:'+'a'*32+':'+'b'*64+']]\nexpired material'
  record={'context':[{'role':'user','content':original},{'role':'assistant','content':'old summary'}]}
  self.assertEqual(completed_chat_context(record,'new upload',True),[])
  normal={'context':[{'role':'user','content':'请用中文回答'},{'role':'assistant','content':'好的'}]}
  self.assertEqual(completed_chat_context(normal,'new upload',True),normal['context'])
 def setUp(self):
  self.folder=tempfile.TemporaryDirectory();self.addCleanup(self.folder.cleanup);self.root=pathlib.Path(self.folder.name)
  self.outputs=[];self.requests=[];self.engines=Mock()
  def http(url,body,**kw):
   self.requests.append((url,body))
   if url.endswith('/apply-template'):return {'prompt':json.dumps(body['messages'])}
   if url.endswith('/tokenize'):return {'tokens':list(range(len(body['content'])//2))}
   if body.get('response_format',{}).get('json_schema',{}).get('name')=='document_risk_type':
    result=self.classification
   else:result=self.outputs.pop(0) if self.outputs else {'verdict':'allow','category':'none'}
   if isinstance(result,Exception):raise result
   if result.get('verdict') in ('allow','block','uncertain') and not (result.get('verdict')=='allow' and result.get('category')!='none'):
    result={'choice':{'allow':'A','block':{'credential':'D','privacy':'E','confidential':'F','sexual':'G','violence':'H','illicit':'I','injection':'J'}.get(result.get('category'),'B'),'uncertain':'C'}[result['verdict']]}
   if body['response_format']['json_schema']['name']=='document_admission' and isinstance(result,dict) and set(result)=={'choice'}:
    self.classification=result
    if result['choice'] in 'BDEFGHIJ':result={'choice':'B'}
   return {'choices':[{'message':{'content':json.dumps(result)},'finish_reason':'stop'}]}
  self.docs=Documents(self.root/'documents',http,self.engines);self.owner='a'*64;self.conversation='b'*32
  self.docs.config_path.write_text(json.dumps({'python_path':os.environ.get('PYTHONPATH','')}))
 def upload(self,raw=None,name='sample.docx'):
  return self.docs.upload(raw if raw is not None else docx(),name,self.owner,self.conversation)
 def messages(self,metadata):
  items,material=self.docs.context([metadata['id']],self.owner,self.conversation,'总结')
  return items,[{'role':'user','content':'总结\n'+material}]
 def test_real_pdf_and_docx_text_tables_headers_and_empty_pdf(self):
  for kind,raw,expected in [('pdf',pdf(),'revenue 42'),('docx',docx(),'合成表格单元格')]:
   p=self.root/('sample.'+kind);p.write_bytes(raw);result=extract(p,kind);self.assertIn(expected,result['text'])
   if kind=='docx':self.assertIn('合成页眉',result['text']);self.assertIn('合成页脚',result['text'])
  p=self.root/'empty.pdf';p.write_bytes(pdf(''))
  with self.assertRaisesRegex(ValueError,'document_no_text'):extract(p,'pdf')
 def test_upload_uses_real_bounded_worker_and_discards_original(self):
  meta=self.upload();self.assertGreater(meta['characters'],10);self.assertNotIn('text',meta)
  self.assertEqual(list((self.root/'documents').glob('extract-*')),[])
  self.assertEqual(list((self.root/'documents').glob('*.json')),[])
 def test_type_signature_size_encryption_and_page_limits(self):
  for raw,name,code in [(pdf(),'bad.doc','document_type'),(b'bad','x.pdf','document_type'),(b'%PDF-'+b'a'*(10*1024**2),'x.pdf','document_size_limit'),(pdf(pages=21),'x.pdf','document_page_limit')]:
   with self.subTest(code=code),self.assertRaisesRegex(DocumentError,code):self.upload(raw,name)
  from pypdf import PdfReader,PdfWriter
  writer=PdfWriter();writer.add_page(PdfReader(io.BytesIO(pdf())).pages[0]);writer.encrypt('synthetic');output=io.BytesIO();writer.write(output)
  with self.assertRaisesRegex(DocumentError,'document_encrypted'):self.upload(output.getvalue(),'locked.pdf')
 def test_device_and_conversation_binding_and_invalid_ids(self):
  meta=self.upload()
  for owner,conversation in [('x'*64,self.conversation),(self.owner,'c'*32)]:
   with self.assertRaisesRegex(DocumentError,'document_denied'):self.docs.get(meta['id'],owner,conversation)
  with self.assertRaises(DocumentError):self.docs.get('../settings',self.owner,self.conversation)
  with self.assertRaises(DocumentError):self.docs.context([meta['id']]*2,self.owner,self.conversation,'x')
 def test_blocked_document_never_loads_model_or_persists_text_and_hook_receipt_blocks(self):
  meta=self.upload(docx('api_key=ORION_DEMO_NOT_A_REAL_CREDENTIAL'));items,messages=self.messages(meta)
  result=self.docs.prepare(messages,items);self.assertEqual(result['verdict'],'block');self.engines.prepare.assert_not_called()
  self.assertEqual(self.requests,[]);self.assertEqual(self.docs.checked(messages)['verdict'],'block')
  self.assertEqual(list((self.root/'documents').glob('*.json')),[])
  with self.assertRaises(DocumentError):self.docs.get(meta['id'],self.owner,self.conversation)
 def test_rejected_turn_does_not_delete_previously_approved_documents(self):
  approved=self.upload();old_items,old_messages=self.messages(approved)
  self.assertEqual(self.docs.prepare(old_messages,old_items)['verdict'],'allow')
  rejected=self.upload(docx('api_key=ORION_DEMO_NOT_A_REAL_CREDENTIAL'),name='blocked.docx')
  new_items,new_messages=self.messages(rejected)
  combined=[*old_messages,{'role':'assistant','content':'previous safe summary'},*new_messages]
  self.assertEqual(self.docs.prepare(combined,[*old_items,*new_items])['verdict'],'block')
  self.assertEqual(self.docs.get(approved['id'],self.owner,self.conversation)['id'],approved['id'])
  with self.assertRaises(DocumentError):self.docs.get(rejected['id'],self.owner,self.conversation)
  self.assertEqual(len(list((self.root/'documents').glob('*.json'))),1)
  followup=[*old_messages,{'role':'assistant','content':'previous safe summary'},{'role':'user','content':'continue with the approved document'}]
  self.assertEqual(self.docs.prepare(followup,old_items)['verdict'],'allow')
 def test_safe_receipt_exact_binding_configuration_change_and_followup(self):
  meta=self.upload();items,messages=self.messages(meta);result=self.docs.prepare(messages,items)
  self.assertEqual(result['verdict'],'allow');self.assertGreater(result['chunks'],0);self.assertEqual(self.docs.checked(messages)['verdict'],'allow')
  self.assertTrue((self.root/'documents'/(meta['id']+'.json')).is_file())
  with self.assertRaises(DocumentError):self.docs.checked([{'role':'user','content':messages[0]['content']+'changed'}])
  self.docs.config_path.write_text(json.dumps({'model':MODELS[1]}))
  with self.assertRaises(DocumentError):self.docs.checked(messages)
  self.docs.prepare(messages,items);self.engines.prepare.assert_called_with(MODELS[1])
  self.assertTrue(any(':17805/' in url for url,_ in self.requests))
 def test_reviewed_documents_release_pending_quota_and_remain_available(self):
  first=None
  for i in range(7):
   meta=self.upload(name='synthetic-'+str(i)+'.docx');items,messages=self.messages(meta)
   self.assertEqual(self.docs.prepare(messages,items)['verdict'],'allow')
   first=first or meta
  self.assertEqual(self.docs.get(first['id'],self.owner,self.conversation)['id'],first['id'])
 def test_model_block_uncertainty_invalid_json_and_failure_never_allow(self):
  for output in [{'verdict':'block','category':'privacy'},{'verdict':'uncertain','category':'uncertain'},{'verdict':'allow','category':'privacy'},TimeoutError('fixture')]:
   with self.subTest(output=output):
    self.outputs=[output]
    if isinstance(output,Exception) or output=={'verdict':'allow','category':'privacy'}:
     with self.assertRaises(Exception):self.docs.review_text('正常合成材料',self.docs.options(),time.monotonic()+20)
    else:self.assertNotEqual(self.docs.review_text('正常合成材料',self.docs.options(),time.monotonic()+20)['verdict'],'allow')
 def test_no_truncation_and_last_chunk_block(self):
  self.outputs=[{'verdict':'allow','category':'none'}]*2+[{'verdict':'block','category':'confidential'}]
  result=self.docs.review_text('public synthetic text '*700,self.docs.options(),time.monotonic()+20)
  self.assertEqual(result['verdict'],'block');self.assertEqual(result['chunks'],3)
  calls=[p for u,p in self.requests if u.endswith('/v1/chat/completions')];self.assertEqual(len(calls),4)
  self.assertTrue(all(p['response_format']['json_schema']['strict'] for p in calls))
 def test_closed_risk_types_and_no_free_form_explanation(self):
  for choice,(verdict,category,reason) in CHOICES.items():
   self.outputs=[{'choice':choice}]
   result=self.docs.review_text('合成审核分类材料',self.docs.options(),time.monotonic()+20)
   self.assertEqual((result['verdict'],result['category'],result['reason_code']),(verdict,category,reason))
   self.assertEqual(set(result),{'verdict','category','reason_code','chunks'})
  for result in [{'choice':'unknown'},{'choice':[]},{'choice':'A','reason':'untrusted explanation'}]:
   self.outputs=[result]
   with self.assertRaises(Exception):self.docs.review_text('合成文字',self.docs.options(),time.monotonic()+20)
 def test_risk_classifier_cannot_release_a_block_even_when_it_fails_or_says_allow(self):
  for classification in ['A','C',TimeoutError('classification unavailable')]:
   with patch.object(self.docs,'model_choice',side_effect=['B',classification]):
    result=self.docs.review_text('合成需要拦截的文字',self.docs.options(),time.monotonic()+20)
    self.assertEqual(result['verdict'],'block');self.assertEqual(result['reason_code'],'document_sensitive')
 def test_specific_block_receipt_reaches_authenticated_hook_and_prompt_changes_invalidate_it(self):
  import controlled_bridge as bridge
  import document_review
  meta=self.upload();items,messages=self.messages(meta);self.outputs=[{'choice':'G'}]
  receipt=self.docs.prepare(messages,items)
  self.assertEqual(receipt['reason_code'],'document_sexual');self.assertEqual(receipt['review_source'],'document')
  with patch.object(bridge,'documents',self.docs),patch.object(bridge,'webhook_input',return_value=(messages,0)),patch.object(bridge,'cached',return_value=None),patch.object(bridge,'event'),patch.object(bridge,'notify'):
   result,status=bridge.safety({'request_id':'fixture'});self.assertEqual(status,200);self.assertEqual(result,{'verdict':'block','reason_code':'document_sexual'})
  with patch.object(document_review,'INSTRUCTION',document_review.INSTRUCTION+' policy changed'):
   with self.assertRaisesRegex(DocumentError,'document_review_missing'):self.docs.checked(messages)
  self.assertEqual(list((self.root/'documents').glob('*.json')),[])
 def test_malformed_config_fails_closed(self):
  for options in [{'model':'http://example.invalid'},{'chunk_tokens':True},{'overlap_tokens':3000}]:
   self.docs.config_path.write_text(json.dumps(options))
   with self.assertRaises(DocumentError):self.docs.options()
 def test_actual_gateway_hook_requires_complete_exact_review_receipt(self):
  import controlled_bridge as bridge
  meta=self.upload();items,messages=self.messages(meta)
  with patch.object(bridge,'documents',self.docs),patch.object(bridge,'webhook_input',return_value=(messages,0)),patch.object(bridge,'cached',return_value=None),patch.object(bridge,'event'),patch.object(bridge,'notify'),patch.object(bridge,'http_json') as http:
   self.assertEqual(bridge.safety({'request_id':'fixture'})[1],503)
   self.docs.prepare(messages,items)
   result,status=bridge.safety({'request_id':'fixture'});self.assertEqual(status,200);self.assertEqual(result['verdict'],'allow')
   self.docs.config_path.write_text(json.dumps({'model':MODELS[1]}))
   self.assertEqual(bridge.safety({'request_id':'fixture'})[1],503)
   http.assert_not_called()
 def test_actual_upload_http_auth_origin_and_binary_validation(self):
  import controlled_bridge as bridge
  import contextlib,http.client,threading,types
  class Handler(bridge.Handler):
   def log_message(self,*args):pass
  with patch.object(bridge,'documents',self.docs),patch.object(bridge,'CONF',{'trusted_client_ips_enabled':False}),patch.object(bridge,'sessions',{}),patch.object(bridge,'agent_proxy',types.SimpleNamespace(identity_cookie=lambda h:None,owner=lambda h:self.owner),create=True):
   server=bridge.http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
   try:
    def request(method,path,body=None,headers=None):
     conn=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=5);conn.request(method,path,body,headers or {});response=conn.getresponse();value=(response.status,json.loads(response.read()),response.getheader('Set-Cookie'));conn.close();return value
    cookie=request('GET','/api/session')[2].split(';')[0]
    url='/api/documents?conversation='+self.conversation+'&name=sample.docx'
    self.assertEqual(request('POST',url,b'fake',{'Content-Type':'application/octet-stream'})[0],401)
    self.assertEqual(request('POST',url,b'fake',{'Content-Type':'application/octet-stream','Cookie':cookie,'Origin':'http://other.invalid'})[0],403)
    status,result,_=request('POST',url,docx(),{'Content-Type':'application/octet-stream','Cookie':cookie});self.assertEqual(status,200);self.assertGreater(result['characters'],0)
    status,result,_=request('POST',url,b'fake',{'Content-Type':'application/octet-stream','Cookie':cookie});self.assertEqual(status,400);self.assertEqual(result['code'],'document_type')
   finally:server.shutdown();server.server_close();thread.join(2)
 def test_oversized_zip_and_dtd_rejected(self):
  for name,body,code in [('word/extra.xml',b'<!DOCTYPE x><x/>','document_xml_denied'),('word/huge.xml',b'a'*(33*1024**2),'document_expanded_limit')]:
   result=io.BytesIO(docx())
   with zipfile.ZipFile(result,'a',zipfile.ZIP_DEFLATED) as archive:archive.writestr(name,body)
   with self.assertRaisesRegex(DocumentError,code):self.upload(result.getvalue())

if __name__=='__main__':unittest.main()
