import importlib.util,pathlib,unittest
path=pathlib.Path(__file__).resolve().parents[1]/'services/decision-models/gliner_cpu.py'
spec=importlib.util.spec_from_file_location('gliner_cpu',path);service=importlib.util.module_from_spec(spec);spec.loader.exec_module(service)
class DecisionContractTests(unittest.TestCase):
 def test_accepts_identical_question_and_preserves_option_order(self):
  q={'type':'choice','instructions':'分类','criteria':{'C':'不明确','B':'复杂','A':'简单'}}
  text,actual=service.validate({'state':'读取介绍','questions':{'route':q}})
  self.assertEqual(text,'读取介绍');self.assertEqual(list(actual['criteria']),['C','B','A'])
 def test_rejects_unbounded_or_arbitrary_requests(self):
  q={'type':'choice','instructions':'分类','criteria':{'A':'简单','B':'复杂','C':'不明确'}}
  for body in [{'state':'x','questions':{'route':q},'model':'cloud'},{'state':'x'*3001,'questions':{'route':q}},{'state':'x','questions':{'other':q}},{'state':'x','questions':{'route':{**q,'criteria':{'A':'x','B':'y'}}}}]:
   with self.assertRaises(ValueError):service.validate(body)
