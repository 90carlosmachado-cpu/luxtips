import unittest,json,math,collections
from pathlib import Path
import simulate as m
R=json.loads((Path(__file__).parent/'results.json').read_text())
class Tests(unittest.TestCase):
 def test_baselines_reproduced(self):
  self.assertEqual((R['overlapping']['unlimited']['summary']['wins'],R['overlapping']['unlimited']['summary']['n']),(6,10));self.assertEqual((R['sequential']['unlimited']['summary']['wins'],R['sequential']['unlimited']['summary']['n']),(3,4))
 def test_market_cap_and_constraints(self):
  for mode in ['overlapping','sequential']:
   for t in R[mode]['max2']['tickets']:
    ls=[m.s.L[i] for i in t['legs']];self.assertTrue(max(collections.Counter(l['market'] for l in ls).values())<=2);self.assertTrue(5<=len(ls)<=12);self.assertTrue(8<=t['odd']<=15+1e-9);self.assertEqual(len(set(l['id'] for l in ls)),len(ls));self.assertEqual(len(set(l['book'] for l in ls)),1);self.assertAlmostEqual(math.prod(l['odd'] for l in ls),t['odd']);self.assertEqual(t['hit'],int(all(l['hit'] for l in ls)));self.assertTrue(all(not l['estimated'] for l in ls))
 def test_sequential_no_reuse_or_overlapping_active_tickets(self):
  for variant in ['unlimited','max2']:
   seen=set();closed=0
   for t in R['sequential'][variant]['tickets']:
    self.assertGreater(m.s.L[t['legs'][0]]['decision'],closed);ids={m.s.L[i]['id'] for i in t['legs']};self.assertFalse(seen&ids);seen|=ids;closed=t['assumed_closed_at']
 def test_selection_does_not_use_target_outcome(self):
  day=R['overlapping']['max2']['tickets'][0]['start'];before=m.pick(day,2);saved=[l['hit'] for l in m.s.L]
  try:
   for l in m.s.L:l['hit']=0
   self.assertEqual(before['legs'],m.pick(day,2)['legs'])
  finally:
   for l,v in zip(m.s.L,saved):l['hit']=v
if __name__=='__main__':unittest.main()
