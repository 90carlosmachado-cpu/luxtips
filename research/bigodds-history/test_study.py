import unittest,json,datetime,math
from pathlib import Path
import numpy as np
ROOT=Path(__file__).parent
class Tests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.R=json.loads((ROOT/'predictions.json').read_text());cls.result=json.loads((ROOT/'results.json').read_text())
 def test_all_predictions_causal_and_normalized(self):
  for r in self.R:
   self.assertLessEqual(r['max_input_completion'],r['decision']);self.assertLess(r['decision'],r['kickoff'])
   for p in r['ps']:
    self.assertAlmostEqual(sum(p[:3]),1,places=9)
    self.assertTrue(all(0<=q<=1 for q in p));self.assertLessEqual(p[5],p[0]+1e-12);self.assertLessEqual(p[6],p[2]+1e-12)
    self.assertLessEqual(p[7],p[3]+1e-12);self.assertLessEqual(p[8],p[4]+1e-12)
 def test_choice_uses_only_2024(self):
  r=self.result
  chosen=min(['goals8','goals4','goals8_elo20','goals8_sot25'],key=lambda m:r['training_2024'][m]['logloss'])
  self.assertEqual(chosen,r['choice_from_2024'])
 def test_tickets_are_not_presented_as_odds_simulations(self):
  for s in self.result['tickets_probability_only']:
   self.assertIsNone(s['odds']);self.assertIsNone(s['roi']);self.assertEqual(s['tickets'],len(s['details']))
   self.assertEqual(s['wins'],sum(t['hit'] for t in s['details']))
   for t in s['details']:self.assertEqual(len(set(t['ids'])),s['nlegs'])
 def test_target_result_not_used_in_prediction(self):
  import study as st
  target=next(f for f in st.F if datetime.datetime.fromtimestamp(f[2]/1000,st.TZ).date().isoformat()=='2025-02-01')
  date=datetime.datetime.fromtimestamp(target[2]/1000,st.TZ).date();cut=int(datetime.datetime.combine(date,datetime.time(8),st.TZ).timestamp()*1000)
  for f in st.F:
   if f[2]+7200000<=cut:st.update(f,f[2]+7200000)
  a=st.predict(target,cut)[0];altered=target.copy();altered[5]=19;altered[6]=18;b=st.predict(altered,cut)[0]
  np.testing.assert_allclose(a,b,atol=1e-12)
if __name__=='__main__':unittest.main()
