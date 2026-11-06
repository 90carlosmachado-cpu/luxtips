import unittest,json,math,datetime
from pathlib import Path
from zoneinfo import ZoneInfo
ROOT=Path(__file__).parent
class Validation(unittest.TestCase):
 def test_all_quotes_known_first_day(self):
  for day,fid,kick,book,market,selection,odd,at,obs in json.loads((ROOT/'quotes.json').read_text()):
   decision=datetime.datetime.combine(datetime.date.fromisoformat(day),datetime.time(8),ZoneInfo('Europe/Lisbon')).timestamp()*1000
   self.assertLessEqual(at,obs);self.assertLessEqual(obs,decision);self.assertLess(decision-at,21600000);self.assertGreater(kick,decision)
 def test_all_forecasts_known_first_day(self):
  for f in json.loads((ROOT/'snapshots.json').read_text()):
   self.assertLessEqual(f['created_at'],f['decision']);self.assertLess(f['created_at'],f['kickoff'])
 def test_tickets_integrity(self):
  r=json.loads((ROOT/'audit.json').read_text())
  allowed={'1','2','1X','X2','1+O1.5','2+O1.5','1X+O1.5','X2+O1.5'}
  for s in r['comparisons']+r['robustness']:
   self.assertEqual(s['wins'],sum(t['hit'] for t in s['tickets']))
   for t in s['tickets']:
    l=t['legs'];self.assertTrue(s['minlegs']<=len(l)<=s['maxlegs']);self.assertEqual(len({x['id'] for x in l}),len(l))
    self.assertEqual(len({x['book'] for x in l}),1)
    teams=[team for x in l for team in [x['homeId'],x['awayId']]];self.assertEqual(len(teams),len(set(teams)))
    self.assertAlmostEqual(math.prod(x['odd'] for x in l),t['odd']);self.assertTrue(s['odd_min']-1e-8<=t['odd']<=s['odd_max']+1e-8)
    self.assertEqual(t['hit'],all(x['hit'] for x in l));self.assertAlmostEqual(t['probability'],math.prod(x['p'] for x in l))
    for x in l:
     self.assertIn(x['market'],allowed);self.assertLessEqual(x['forecastAt'],x['decision']);self.assertLessEqual(x['observedAt'],x['decision'])
     self.assertTrue(t['start']<=x['day']<t['end_exclusive']);self.assertTrue(x['odd']>=1.2 and x['p']>=.5)
 def test_no_result_enters_selection(self):
  from engine import optimize
  g=[[dict(id=i,homeId=i,awayId=100+i,p=.75,odd=1.6,estimated=False,hit=True)] for i in range(5)]
  a=optimize(g,True,1,5,5)
  for opts in g:
   for o in opts:o['hit']=False
  b=optimize(g,True,1,5,5)
  self.assertEqual([x['id'] for x in a['legs']],[x['id'] for x in b['legs']])
if __name__=='__main__':unittest.main()
