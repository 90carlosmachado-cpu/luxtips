import unittest,math,json
import simulate as s
class Checks(unittest.TestCase):
 def test_calibration_marginals(self):
  a=s.calibrate([[.50,.10],[.12,.08],[.15,.05]],[.65,.20,.15],.85)
  for row,target in zip(a,[.65,.20,.15]):self.assertAlmostEqual(sum(row),target,7)
  self.assertAlmostEqual(sum(row[0] for row in a),.85,7)
  self.assertGreater(a[0][0],.65*.85) # Preserve positive event dependence.
 def test_actual_tickets(self):
  r=json.loads((s.ROOT/'results.json').read_text())
  for scenario in r['scenarios']:
   days=[]
   for t in scenario['tickets']:
    days.append(t['day']);legs=t['legs']
    self.assertEqual(len(legs),scenario['legs']);self.assertEqual(len({x['id'] for x in legs}),len(legs))
    self.assertEqual(len({x['book'] for x in legs}),1)
    self.assertTrue(10-1e-8<=math.prod(x['odd'] for x in legs)<=12+1e-8)
    self.assertAlmostEqual(t['probability'],math.prod(x['p'] for x in legs))
    self.assertEqual(t['hit'],all(x['hit'] for x in legs))
   self.assertEqual(len(days),len(set(days)))
 def test_no_result_used_in_optimizer(self):
  groups=[[{'id':i,'p':.75,'odd':1.8,'estimated':False,'hit':True} ] for i in range(5)]
  a=s.optimize(groups,4)
  for g in groups:
   for o in g:o['hit']=False
  b=s.optimize(groups,4)
  self.assertEqual([x['id'] for x in a['legs']],[x['id'] for x in b['legs']])
  self.assertEqual(a['probability'],b['probability'])
 def test_combo_prices_obey_subset_relationship(self):
  for books in s.pool.values():
   for groups in books.values():
    for choices in groups:
     by={x['market']:x for x in choices}
     for code,leg in by.items():
      if leg['estimated']:
       base=by[code.replace('+O1.5','')]
       self.assertGreaterEqual(leg['odd'],base['odd'])
       self.assertLessEqual(leg['model'],base['model'])
       self.assertLessEqual(leg['market_p'],base['market_p'])
if __name__=='__main__':unittest.main()
