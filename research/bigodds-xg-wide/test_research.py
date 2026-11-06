import unittest,json,math,datetime,itertools
from pathlib import Path
import numpy as np
import search as s
ROOT=Path(__file__).parent
class ResearchTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.r=json.loads((ROOT/'results.json').read_text());cls.a=json.loads((ROOT/'audit.json').read_text());cls.alt=json.loads((ROOT/'alternatives.json').read_text())
 def test_complete_predefined_grid(self):
  self.assertEqual(len(s.MODELS),297);self.assertEqual(s.PER_MODEL,3456);self.assertEqual(self.r['protocol']['policies'],1026432)
  with (ROOT/'all-policies.csv').open() as f:
   next(f);count=0
   for expected,line in enumerate(f):self.assertEqual(int(line.split(',',1)[0]),expected);count+=1
  self.assertEqual(count,1026432)
 def test_original_six_of_eleven_reproduced(self):
  mi=next(i for i,m in enumerate(s.MODELS) if m==dict(half_life=180,prior=4,xg_weight=0,min_xg_role=0,market_mix=0));base=('all_real',.5,1.2,0,'probability','fallback','any')
  ts=s.tickets_for(mi,base,2,(5,12),s.prepare(mi));ref=json.loads((s.BASE/'results.json').read_text())['hindsight_only']['2']['tickets']
  self.assertEqual([(t['start'],t['legs'],t['hit']) for t in ts],[(t['start'],t['legs'],t['hit']) for t in ref])
 def slow(self,mi,base,span,profile):
  P,A,D,scores,orders=s.prepare(mi);market,pmin,omin,smin,ranking,xmode,direction=base;score=scores[ranking];out=[]
  for day,books in sorted(s.POOL.items()):
   last=(datetime.date.fromisoformat(day)+datetime.timedelta(days=span-1)).isoformat()
   if last>'2026-11-04':continue
   best=None
   for book,groups in books.items():
    selected=[]
    for g in groups:
     if s.L[g[0]]['day']>last:continue
     eligible=[i for i in g if s.ALLOWED[market][i] and P[i]>=pmin and s.odd[i]>=omin and s.sample[i]>=smin and (xmode!='required' or A[i]) and (direction!='fixed' or s.side[i]==0 or s.side[i]==D[i])]
     if eligible:selected.append(max(eligible,key=lambda i:(score[i],P[i],-i)))
    selected.sort(key=lambda i:(-score[i],-P[i],i));lp=lo=0.;ids=[]
    for n,i in enumerate(selected[:12],1):
     lp+=float(np.log(max(P[i],1e-15)));lo+=float(s.logodd[i]);ids.append(i)
     if lo>math.log(15)+1e-12:break
     if profile[0]<=n<=profile[1] and math.log(8)-1e-12<=lo<=math.log(15)+1e-12:
      if best is None or lp>best[0]:best=(lp,math.exp(lo),ids.copy(),book)
   if best:out.append((day,best[3],best[2],best[1]))
  return out
 def test_vectorized_optimizer_matches_independent_slow_reference(self):
  cases=[(mi,base,span,profile) for mi,base,span,profile in [
   (0,('all_real',.5,1.2,0,'probability','fallback','any'),2,(5,12)),
   (99,('no_unders',.65,1.05,0,'efficiency','fallback','fixed'),3,(5,12)),
   (150,('goals',.5,1.2,12,'edge','required','any'),2,(8,12)),
   (296,('sides',.5,1.05,0,'probability','required','fixed'),1,(5,12)),
   (100,('all_real',.8,1.2,0,'efficiency','required','fixed'),3,(5,12))]]
  for mi,base,span,profile in cases:
   fast=s.tickets_for(mi,base,span,profile,s.prepare(mi));slow=self.slow(mi,base,span,profile)
   self.assertEqual([(t['start'],t['book'],t['legs']) for t in fast],[(d,b,ids) for d,b,ids,o in slow]);self.assertTrue(all(abs(t['odd']-o)<1e-9 for t,(_,_,_,o) in zip(fast,slow)))
 def test_clocks_probabilities_and_non_xg_controls(self):
  self.assertTrue(np.isfinite(s.ALLP).all());self.assertTrue(((s.ALLP>=0)&(s.ALLP<=1)).all())
  for row in json.loads((ROOT/'clock-audit.json').read_text()):self.assertLessEqual(row['max_xg_observed'],row['decision']);self.assertLessEqual(row['max_xg_completion'],row['decision'])
  for i,m in enumerate(s.MODELS):
   if m['xg_weight']==0:self.assertFalse(s.ALLA[i].any())
 def test_ticket_constraints_receipts_and_outcomes(self):
  receipts=set()
  for day,fid,kick,book,market,selection,odd,at,obs in json.loads((s.BASE/'quotes.json').read_text()):
   code=None
   if market=='Match Winner':code={'Home':'1','Away':'2'}.get(selection)
   elif market=='Double Chance':code={'Home/Draw':'1X','Draw/Away':'X2'}.get(selection)
   elif market=='Both Teams Score':code={'Yes':'BY','No':'BN'}.get(selection)
   elif market=='Goals Over/Under':side,total=selection.split();code=('O' if side=='Over' else 'U')+total.replace('.','')
   if code:receipts.add((fid,kick,book,code,odd,at,obs))
  for record in list(self.r['leaders'].values())+list(self.alt['alternatives'].values()):
   for t in record['tickets']:
    legs=[s.L[i] for i in t['legs']];self.assertTrue(5<=len(legs)<=12);self.assertTrue(8-1e-8<=t['odd']<=15+1e-8);self.assertAlmostEqual(t['odd'],math.prod(l['odd'] for l in legs));self.assertEqual(t['hit'],int(all(l['hit'] for l in legs)));self.assertEqual(len({l['id'] for l in legs}),len(legs));self.assertEqual(len({l['book'] for l in legs}),1)
    for l in legs:
     self.assertFalse(l['estimated']);self.assertIn((l['id'],l['kickoff'],l['book'],l['market'],l['odd'],l['quote_at'],l['observed_at']),receipts);self.assertLessEqual(l['observed_at'],l['decision']);self.assertLess(l['decision']-l['quote_at'],21600000)
 def test_purged_train_evaluation_and_summary(self):
  for record in self.r['leaders'].values():
   tr=[t for t in record['tickets'] if t['last']<='2026-10-29'];ev=[t for t in record['tickets'] if t['start']>='2026-10-30'];self.assertEqual(record['train']['wins'],sum(t['hit'] for t in tr));self.assertEqual(record['evaluation']['wins'],sum(t['hit'] for t in ev))
   self.assertFalse({s.L[i]['id'] for t in tr for i in t['legs']}&{s.L[i]['id'] for t in ev for i in t['legs']})
  self.assertEqual(self.r['leaders']['xg_full']['all']['wins'],6);self.assertEqual(self.r['leaders']['xg_full']['all']['n'],9)
 def test_sequential_no_simultaneous_ticket_or_reused_fixture(self):
  for variant in [self.a['sequential_xg_full']]+[a['sequential'] for a in self.alt['alternatives'].values()]:
   used=set();closed=0
   for t in variant['tickets']:
    cut=s.L[t['legs'][0]]['decision'];self.assertGreater(cut,closed);ids={s.L[i]['id'] for i in t['legs']};self.assertFalse(used&ids);used|=ids;closed=t['assumed_closed_at']
 def test_selection_never_depends_on_target_outcomes(self):
  mi=next(i for i,m in enumerate(s.MODELS) if m==self.r['leaders']['xg_full']['rule']['model']);base=('all_real',.5,1.2,0,'probability','required','any');prepared=s.prepare(mi);before=s.tickets_for(mi,base,3,(5,12),prepared);saved=s.hit.copy()
  try:
   s.hit[:]=0;after=s.tickets_for(mi,base,3,(5,12),prepared);self.assertEqual([(t['start'],t['book'],t['legs']) for t in before],[(t['start'],t['book'],t['legs']) for t in after])
  finally:s.hit[:]=saved
if __name__=='__main__':unittest.main()
