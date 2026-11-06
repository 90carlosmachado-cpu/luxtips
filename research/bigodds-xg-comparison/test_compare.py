import unittest,json,math,datetime
from pathlib import Path
import compare as c
ROOT=Path(__file__).parent
class ComparisonTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.r=json.loads((ROOT/'results.json').read_text());cls.p=json.loads((ROOT/'predictions.json').read_text())
 def test_original_baseline_reproduced_exactly(self):
  actual=self.r['tickets']['goals4'];expected=c.REFERENCE['tickets'];self.assertEqual(len(actual),11);self.assertEqual(sum(t['hit'] for t in actual),6)
  for a,b in zip(actual,expected):self.assertEqual((a['start'],a['legs'],a['hit']),(b['start'],b['legs'],b['hit']));self.assertAlmostEqual(a['odd'],b['odd'])
 def test_available_xg_uses_only_past_observed_data(self):
  for p in self.p:
   cut=p['decision'];v=p['available'];self.assertLessEqual(v['max_xg_observed'],cut);self.assertLessEqual(v['max_xg_completion'],cut);self.assertGreater(c.b.FD[p['fixture']][2],cut)
   if v['active']:
    self.assertTrue(all(n>=4 for n in v['xg_role_weighted']));self.assertTrue(all(n>=20 for n in v['xg_league_weighted']))
   else:self.assertEqual(v['goals'],v['blended_goals']);self.assertEqual(v['baseline'],v['probabilities'])
 def test_ticket_constraints_and_outcomes(self):
  for ts in self.r['tickets'].values():
   self.assertEqual([t['start'] for t in ts],[t['start'] for t in self.r['tickets']['goals4']])
   for t in ts:
    legs=[c.L[i] for i in t['legs']];self.assertTrue(5<=len(legs)<=12);self.assertTrue(8<=t['odd']<=15+1e-9);self.assertEqual(len({l['book'] for l in legs}),1);self.assertEqual(len({l['id'] for l in legs}),len(legs));self.assertAlmostEqual(t['odd'],math.prod(l['odd'] for l in legs));self.assertEqual(t['hit'],int(all(l['hit'] for l in legs)))
    for l in legs:self.assertLessEqual(l['quote_at'],l['observed_at']);self.assertLessEqual(l['observed_at'],l['decision']);self.assertLess(l['decision']-l['quote_at'],21600000);self.assertLess(l['decision'],l['kickoff']);self.assertFalse(l['estimated'])
 def test_outcomes_cannot_affect_selection(self):
  P=[l['ps'][c.baseline_source] for l in c.L];original=c.replay(P);hits=[l['hit'] for l in c.L]
  try:
   for l in c.L:l['hit']=0
   changed=c.replay(P)
   self.assertEqual([(t['start'],t['book'],t['legs'],t['odd']) for t in original],[(t['start'],t['book'],t['legs'],t['odd']) for t in changed])
  finally:
   for l,hit in zip(c.L,hits):l['hit']=hit
 def test_target_score_cannot_affect_probabilities(self):
  c.rebuild_probabilities();cut=max(l['decision'] for l in c.L);fid=next(l['id'] for l in c.L if l['decision']==cut);f=c.b.FD[fid];st=c.xg_stats(cut,True)
  original=c.prediction(f,cut,st);altered=f.copy();altered[5:7]=[20,0];self.assertEqual(original,c.prediction(altered,cut,st))
 def test_prices_of_selected_legs_are_real_archived_quotes(self):
  receipts=set()
  for day,fid,kick,book,market,selection,odd,at,obs in json.loads((c.BASE/'quotes.json').read_text()):
   code=None
   if market=='Match Winner':code={'Home':'1','Away':'2'}.get(selection)
   elif market=='Double Chance':code={'Home/Draw':'1X','Draw/Away':'X2'}.get(selection)
   elif market=='Both Teams Score':code={'Yes':'BY','No':'BN'}.get(selection)
   elif market=='Goals Over/Under':
    side,total=selection.split(' ');code=('O' if side=='Over' else 'U')+total.replace('.','')
   if code:receipts.add((fid,kick,book,code,odd,at,obs))
  for ts in self.r['tickets'].values():
   for t in ts:
    for i in t['legs']:
     l=c.L[i];self.assertIn((l['id'],l['kickoff'],l['book'],l['market'],l['odd'],l['quote_at'],l['observed_at']),receipts)
if __name__=='__main__':unittest.main()
