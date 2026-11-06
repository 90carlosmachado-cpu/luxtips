import json,collections,math,random,statistics,datetime
from pathlib import Path
import engine as e
ROOT=Path(__file__).parent

def calibration(rows):
 if not rows:return {'n':0}
 return {'n':len(rows),'fixtures':len({x['id'] for x in rows}),'actual':sum(x['hit'] for x in rows)/len(rows),**{k:{'mean':sum(x[k] for x in rows)/len(rows),'brier':sum((x[k]-x['hit'])**2 for x in rows)/len(rows)} for k in ['model_p','market_p','p']}}

# Deduplicate books and overlapping day windows. Retain the last available
# decision time per fixture, then average probabilities across quoted books.
latest={}
for day,books in e.pool.items():
 for book,groups in books.items():
  for group in groups:
   for l in group:latest[l['id']]=max(day,latest.get(l['id'],day))
by=collections.defaultdict(list)
for day,books in e.pool.items():
 for groups in books.values():
  for group in groups:
   for l in group:
    if day==latest[l['id']]:by[(l['id'],l['market'])].append(l)
rows=[]
for key,legs in by.items():
 x=dict(legs[0]);x['books']=len(legs)
 for k in ['model_p','market_p','p']:x[k]=sum(l[k] for l in legs)/len(legs)
 x['odd']=sum(l['odd'] for l in legs)/len(legs);rows.append(x)
# Include only selections that could enter the current prototype.
eligible=[x for x in rows if x['p']>=.5 and x['odd']>=1.2]
by_market={m:calibration([x for x in eligible if x['market']==m]) for m in sorted({x['market'] for x in eligible})}
bins={f'{lo:.0%}–{hi:.0%}':calibration([x for x in eligible if lo<=x['p']<hi]) for lo,hi in [(0.5,.6),(.6,.7),(.7,.8),(.8,.9),(.9,1.00001)]}
# Fairer benchmark on basic winner sides; combo market marginals are synthetic.
basic=[x for x in eligible if not x['estimated']]
cluster=collections.defaultdict(list)
for x in basic:cluster[x['id']].append((x['model_p']-x['hit'])**2-(x['market_p']-x['hit'])**2)
ids=list(cluster);rng=random.Random(20261105);boot=[]
for _ in range(2000):
 sample=[rng.choice(ids) for _ in ids];nums=[v for i in sample for v in cluster[i]];boot.append(sum(nums)/len(nums))
boot.sort();brier_diff={'model_minus_market':sum(v for a in cluster.values() for v in a)/sum(map(len,cluster.values())),'fixture_cluster_bootstrap_95':[boot[49],boot[1949]],'fixtures':len(ids),'event_rows':len(basic)}
# All data were already inspected earlier. This is a chronological diagnostic
# split, NOT fresh or independent validation, and is not used to tune weights.
split={name:calibration([x for x in eligible if (x['day']<'2026-10-30')==early]) for name,early in [('24–29 Oct',True),('30 Oct–4 Nov',False)]}
# Audit previously selected tickets: appearances and unique fixture-market rows
# are separate, as overlapping windows repeat the same losses.
previous=json.loads((ROOT.parent/'bigodds-8-15/results.json').read_text())
losses=[]
for s in previous['scenarios']:
 if s['variant']=='nominal' and s['odd_min']==8 and s['odd_max']==15:
  for t in s['tickets']:
   for l in t['legs']:losses.append(dict(l,start=t['start'],span=s['span']))
counts=collections.Counter((x['id'],x['market']) for x in losses if not x['hit'])
repeated=[dict(id=fid,market=m,appearances=count,home=next(x['home'] for x in losses if x['id']==fid),away=next(x['away'] for x in losses if x['id']==fid)) for (fid,m),count in counts.most_common()]
selected_unique={ (l['id'],l['market']):l for l in losses }
result={'calibration':{'all_eligible':calibration(eligible),'basic_only':calibration(basic),'by_market':by_market,'bins':bins,'chronological_diagnostic':split,'brier_model_vs_market':brier_diff},'calibration_event_rows':eligible,'previous_ticket_audit':{'ticket_leg_appearances':len(losses),'winning_appearances':sum(x['hit'] for x in losses),'unique_fixture_markets':len(selected_unique),'winning_unique':sum(x['hit'] for x in selected_unique.values()),'repeated_losses':repeated},'comparisons':[],'warning':'Same previously inspected short sample; chronological split is not independent validation. Market probabilities for combo rows are synthetic, so basic-only benchmark is the primary Brier comparison.'}
(ROOT/'audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print(json.dumps({'all':result['calibration']['all_eligible'],'basic':result['calibration']['basic_only'],'brier':brier_diff,'repeated_losses':repeated[:4]},ensure_ascii=False),flush=True)
original={id(l):l['p'] for books in e.pool.values() for groups in books.values() for g in groups for l in g}
for basis in ['blended','market_reference']:
 for books in e.pool.values():
  for groups in books.values():
   for g in groups:
    for l in g:l['p']=original[id(l)] if basis=='blended' else l['market_p']
 for span in [2,3]:
  for mn,mx in [(5,7),(8,12)]:
   s=e.scenario(span,True,1,mx,mn,8,15);s['basis']=basis
   s['hit_rate']=s['wins']/s['played'] if s['played'] else None
   result['comparisons'].append(s)
   (ROOT/'audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
   print(json.dumps({k:v for k,v in s.items() if k!='tickets'},ensure_ascii=False),flush=True)
