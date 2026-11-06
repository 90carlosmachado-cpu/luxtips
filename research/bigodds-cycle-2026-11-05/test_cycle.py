import unittest,json,math,hashlib
from pathlib import Path
ROOT=Path(__file__).parent
class Tests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.C=json.loads((ROOT/'candidate.json').read_text());cls.R=json.loads((ROOT/'cycle.json').read_text());cls.L=json.loads((ROOT/'legs.json').read_text());cls.S=json.loads((ROOT/'model-sources.json').read_text())
 def test_candidate_frozen_unchanged(self):
  old=json.loads((ROOT.parent/'bigodds-wide/candidate-research-only.json').read_text())
  self.assertEqual(self.C['rule'],old['rule'])
  for name,digest in self.C['candidate_code_sha256'].items():self.assertEqual(hashlib.sha256((ROOT/name).read_bytes()).hexdigest(),digest)
 def test_selected_ticket_rules_and_product(self):
  t=self.R['ticket'];legs=[self.L[i] for i in t['legs']];s=self.S.index('goals4')
  self.assertTrue(5<=len(legs)<=12);self.assertEqual(len({l['id'] for l in legs}),len(legs));self.assertEqual(len({l['book'] for l in legs}),1)
  self.assertTrue(8<=t['odd']<=15);self.assertAlmostEqual(t['odd'],math.prod(l['odd'] for l in legs));self.assertAlmostEqual(t['joint_model_probability'],math.prod(l['ps'][s] for l in legs))
  self.assertEqual(t['joint_model_probability'],max(x['joint_model_probability'] for x in self.R['other_feasible_tickets']))
  for l in legs:self.assertGreaterEqual(l['ps'][s],.5);self.assertGreaterEqual(l['odd'],1.2);self.assertFalse(l['estimated'])
 def test_all_inputs_known_at_decision(self):
  for l in self.L:
   self.assertLessEqual(l['quote_at'],l['observed_at']);self.assertLessEqual(l['observed_at'],l['decision']);self.assertLess(l['decision']-l['quote_at'],21600000);self.assertLessEqual(l['candidate_max_input'],l['decision']);self.assertLess(l['decision'],l['kickoff'])
 def test_no_results_loaded(self):
  self.assertFalse(self.R['used_current_results']);self.assertIsNone(self.R['settlement']);self.assertFalse(self.R['production_changes'])
  for l in self.L:self.assertIsNone(l['hit']);self.assertIsNone(l['score'])
  for f in json.loads((ROOT/'snapshots.json').read_text()):self.assertNotIn('hg',f);self.assertNotIn('ag',f)
 def test_selected_prices_are_matching_receipts(self):
  quotes=json.loads((ROOT/'quotes.json').read_text())
  for i in self.R['ticket']['legs']:
   l=self.L[i];code=l['market'];market,sel= ('Double Chance',{'1X':'Home/Draw','X2':'Draw/Away'}[code]) if code in ['1X','X2'] else ('Goals Over/Under',('Over' if code[0]=='O' else 'Under')+' '+code[1]+'.'+code[2])
   self.assertTrue(any(fid==l['id'] and kick==l['kickoff'] and book==l['book'] and m==market and selection==sel and odd==l['odd'] and at==l['quote_at'] and obs==l['observed_at'] for day,fid,kick,book,m,selection,odd,at,obs in quotes))
if __name__=='__main__':unittest.main()
