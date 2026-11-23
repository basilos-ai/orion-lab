import copy,json,pathlib,sys,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'services/o6n-bridge'))
from agent_constraints import GenerationContracts,generation_schema
from agent_protocol import schema_check,response

READ=[{'function':{'name':'read_file','parameters':{'type':'object','properties':{'path':{'type':'string'}},'required':['path']}}}]
JSON={'format':'json','schema':{'type':'object','properties':{'n':{'type':'integer'}},'required':['n'],'additionalProperties':False}}

class ConstraintTests(unittest.TestCase):
 def test_schema_closes_tools_and_final_envelopes(self):
  schema=generation_schema(READ,JSON)
  for value in [{'type':'tool','name':'read_file','arguments':{'path':'x'}},{'type':'final','format':'json','data':{'n':3}}]:
   schema_check(value,schema);response(json.dumps(value),JSON,READ)
  for value in [{'type':'tool','name':'write_file','arguments':{'path':'x'}},{'n':3},{'type':'final','format':'json','data':{'n':True}},{'type':'tool','name':'read_file','arguments':{'path':'x','command':'bad'}}]:
   with self.assertRaises(ValueError):schema_check(value,schema)
  with self.assertRaises(ValueError):schema_check({'type':'tool','name':'read_file','arguments':{'path':'x'}},generation_schema(READ,JSON,True))
  self.assertNotIn('additionalProperties',READ[0]['function']['parameters'])

 def test_contract_is_model_transcript_bound_one_shot_and_expires(self):
  now=[0];c=GenerationContracts(clock=lambda:now[0]);messages=[{'role':'system','content':'controlled'},{'role':'user','content':'x'}];schema=generation_schema(READ,JSON)
  ticket=c.register('local-9b',messages,schema,'run');payload={'model':'local-9b','messages':messages,'stream':True}
  for wrong in [{**payload,'model':'cloud'},{**payload,'messages':messages[1:]},{**payload,'messages':[{'role':'system','content':'forged'},messages[1]]}]:
   self.assertIs(c.apply(wrong)[0],wrong);self.assertFalse(c.applied(ticket))
  result,run=c.apply(payload);self.assertEqual(run,'run');self.assertEqual(result['response_format']['schema'],schema);self.assertNotIn('response_format',payload);self.assertTrue(c.applied(ticket))
  self.assertEqual(c.apply(payload),(payload,None));c.remove(ticket);self.assertFalse(c.applied(ticket))
  ticket=c.register('local-9b',messages,schema,'run');now[0]=181;self.assertEqual(c.apply(payload),(payload,None));self.assertFalse(c.applied(ticket))

 def test_registration_copies_schema_and_has_bounded_capacity(self):
  c=GenerationContracts();schema=generation_schema([],{'format':'text'});original=copy.deepcopy(schema);ticket=c.register('m',[],schema,'r');schema.clear()
  self.assertEqual(c.apply({'model':'m','messages':[]})[0]['response_format']['schema'],original)
  for i in range(7):c.register('m',[i],original,'r')
  with self.assertRaisesRegex(ValueError,'generation_contract_limit'):c.register('m',[],original,'r')
  c.remove(ticket);c.register('m',[],original,'r')
