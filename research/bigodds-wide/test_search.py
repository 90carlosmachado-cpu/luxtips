import unittest,json,math,datetime,collections
from pathlib import Path
from zoneinfo import ZoneInfo
ROOT=Path(__file__).parent
class Tests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.L=json.loads((ROOT/'legs.json').read_text());cls.R=json.loads((ROOT/'results.json').read_text());cls.sources=json.loads((ROOT/'model-sources.json').read_text())
 def test_event_outcomes_against_fixture_export(self):
  fixtures={f[0]:f for f in json.loads((ROOT.parent/'bigodds-history/fixtures-2026.json').read_text())}
  for l in self.L:
   f=fixtures[l['id']];h,a=f[5],f[6];self.assertEqual(l['score'],f'{h}-{a}')
   c=l['market'];base={'1':h>a,'2':a>h,'1X':h>=a,'X2':a>=h,'BY':h>0 and a>0,'BN':h==0 or a==0}
   if '+O15' in c:hit=base[c.split('+')[0]] and h+a>=2
   elif c[0] in 'OU':hit=h+a>int(c[1]) if c[0]=='O' else h+a<=int(c[1])
   else:hit=base[c]
   self.assertEqual(l['hit'],int(hit))
 def test_clock_and_probabilities(self):
  for l in self.L:
   self.assertLessEqual(l['quote_at'],l['observed_at']);self.assertLessEqual(l['observed_at'],l['decision']);self.assertLess(l['decision']-l['quote_at'],21600000)
   self.assertLess(l['decision'],l['kickoff']);self.assertLessEqual(l['candidate_max_input'],l['decision']);self.assertTrue(all(0<=p<=1 for p in l['ps']))
 def test_unestimated_prices_are_archived_receipts(self):
  q=set()
  for day,fid,kick,book,market,selection,odd,at,obs in json.loads((ROOT/'quotes.json').read_text()):
   code=None
   if market=='Match Winner':code={'Home':'1','Away':'2'}.get(selection)
   elif market=='Double Chance':code={'Home/Draw':'1X','Draw/Away':'X2'}.get(selection)
   elif market=='Both Teams Score':code={'Yes':'BY','No':'BN'}.get(selection)
   elif market=='Goals Over/Under':
    side,total=selection.split(' ');code=('O' if side=='Over' else 'U')+total.replace('.','')
   if code:q.add((day,fid,kick,book,code,odd,at,obs))
  for l in self.L:
   if not l['estimated']:
    day=datetime.datetime.fromtimestamp(l['decision']/1000,ZoneInfo('Europe/Lisbon')).date().isoformat()
    self.assertIn((day,l['id'],l['kickoff'],l['book'],l['market'],l['odd'],l['quote_at'],l['observed_at']),q)
 def test_leader_tickets(self):
  for category in ['training_selected','hindsight_only']:
   for v in self.R[category].values():
    s=self.sources.index(v['rule']['source']);band=v['rule']['odd_band']
    for t in v['tickets']:
     legs=[self.L[i] for i in t['legs']];self.assertEqual(len({l['id'] for l in legs}),len(legs));self.assertEqual(len({l['book'] for l in legs}),1)
     self.assertAlmostEqual(t['odd'],math.prod(l['odd'] for l in legs));self.assertAlmostEqual(t['p'],math.prod(l['ps'][s] for l in legs));self.assertEqual(t['hit'],int(all(l['hit'] for l in legs)))
     self.assertTrue(band[0]-1e-9<=t['odd']<=band[1]+1e-9);self.assertTrue(v['rule']['n_min']<=len(legs)<=v['rule']['n_max'])
     for l in legs:self.assertTrue(t['start']<=l['day']<=t['last'])
    trainids={self.L[i]['id'] for t in v['tickets'] if t['last']<='2026-10-29' for i in t['legs']}
    testids={self.L[i]['id'] for t in v['tickets'] if t['start']>='2026-10-30' for i in t['legs']}
    self.assertFalse(trainids&testids)
 def test_training_leader_chosen_without_evaluation(self):
  best={};n=0
  with (ROOT/'all-policies.jsonl').open() as source:
   for line in source:
    r=json.loads(line);n+=1;t=r['train']
    if t['n']<3:continue
    band=tuple(r['rule']['odd_band']);key=((t['wins']+1)/(t['n']+2),t['n'],-r['id'])
    if band not in best or key>best[band][0]:best[band]=(key,r['id'])
  self.assertEqual(n,93312)
  for v in self.R['training_selected'].values():self.assertEqual(best[tuple(v['rule']['odd_band'])][1],v['id'])
if __name__=='__main__':unittest.main()
