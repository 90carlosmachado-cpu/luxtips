"""Paired fixed-rule test: only add a maximum of two selections per market code.
No market substitutions within a fixture just to satisfy the cap; no outcome use.
"""
import sys,json,math,datetime,collections,csv
from pathlib import Path
ROOT=Path(__file__).parent;WIDE=ROOT.parent/'bigodds-xg-wide';sys.path.insert(0,str(WIDE));import search as s;import audit
R=json.loads((WIDE/'alternatives.json').read_text())['alternatives']['no_unders'];mi,base,span,profile=audit.unpack(R);P,A,D,SCORES,ORDERS=s.prepare(mi)

def pick(day,cap=None,blocked=frozenset()):
 last=(datetime.date.fromisoformat(day)+datetime.timedelta(days=span-1)).isoformat()
 if last>'2026-11-04':return None
 market,pmin,omin,smin,rank,xmode,direction=base;score=SCORES[rank];best=None
 for book,groups in s.POOL[day].items():
  selected=[]
  for group in groups:
   if s.L[group[0]]['day']>last or s.L[group[0]]['id'] in blocked:continue
   eligible=[i for i in group if s.ALLOWED[market][i] and P[i]>=pmin and s.odd[i]>=omin and s.sample[i]>=smin and(xmode!='required' or A[i])and(direction!='fixed' or s.side[i]==0 or s.side[i]==D[i])]
   if eligible:selected.append(max(eligible,key=lambda i:(score[i],P[i],-i)))
  selected.sort(key=lambda i:(-score[i],-P[i],i));counts=collections.Counter();filtered=[]
  for i in selected:
   code=s.L[i]['market']
   if cap is not None and counts[code]>=cap:continue
   filtered.append(i);counts[code]+=1
  lp=lo=0.;ids=[]
  for n,i in enumerate(filtered[:12],1):
   lp+=math.log(max(P[i],1e-15));lo+=math.log(s.L[i]['odd']);ids.append(i)
   if lo>math.log(15)+1e-12:break
   odd=math.exp(lo)
   if 5<=n<=12 and 8<=odd<=15+1e-10 and(best is None or lp>best[0]):best=(lp,odd,ids.copy(),book)
 if best:
  lp,odd,ids,book=best
  return {'start':day,'last':last,'book':book,'odd':odd,'legs':ids,'hit':int(all(s.L[i]['hit'] for i in ids)),'xg_legs':int(A[ids].sum()),'markets':dict(collections.Counter(s.L[i]['market'] for i in ids))}

def replay(cap,sequential=False):
 tickets=[];skipped=[];blocked=set();closed=0
 for day in s.DAYS:
  if(datetime.date.fromisoformat(day)+datetime.timedelta(days=span-1)).isoformat()>'2026-11-04':continue
  cut=next(l['decision'] for l in s.L if datetime.date.fromtimestamp(l['decision']/1000).isoformat()==day)
  if sequential and closed>=cut:skipped.append({'day':day,'reason':'active_at_08h'});continue
  t=pick(day,cap,blocked if sequential else frozenset())
  if not t:skipped.append({'day':day,'reason':'no_eligible_ticket'});continue
  if sequential:
   losses=[s.L[i]['kickoff']+7200000 for i in t['legs'] if not s.L[i]['hit']];closed=min(losses)if losses else max(s.L[i]['kickoff']+7200000 for i in t['legs']);blocked.update(s.L[i]['id'] for i in t['legs']);t['assumed_closed_at']=closed
  tickets.append(t)
 return {'summary':s.aggregate(tickets),'tickets':tickets,'skipped':skipped}

def run():
 results={'protocol':{'rule':R['rule'],'change':'max2 selections per exact market code:1,2,1X,X2,O15,O25,O35,BY,BN','construction':'Choose the highest-ranked allowed market per fixture first; skip that fixture if its market quota is full, without changing its market; keep other rules identical. No forced quotas and no parameter search.','prices':'Same real archived quotes as the prior xG study','clocks':'08h Lisbon, prior xG observed before decision','sequential_assumption':'Final results assumed known kickoff+2h, not real historic settlement clocks','caveat':'Already inspected small historical period. Overlapping windows reuse games. No production change.'}}
 for mode in ['overlapping','sequential']:
  results[mode]={'unlimited':replay(None,mode=='sequential'),'max2':replay(2,mode=='sequential')}
 for t,old in zip(results['overlapping']['unlimited']['tickets'],R['tickets']):assert(t['start'],t['legs'],t['hit'])==(old['start'],old['legs'],old['hit'])
 assert results['overlapping']['unlimited']['summary']['wins']==6 and results['overlapping']['unlimited']['summary']['n']==10
 assert results['sequential']['unlimited']['summary']['wins']==3 and results['sequential']['unlimited']['summary']['n']==4
 (ROOT/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
 with(ROOT/'tickets.csv').open('w',newline='')as f:
  w=csv.writer(f);w.writerow(['mode','variant','decision_day','ticket_odd','ticket_hit','book','game_day','home','away','market','odd','score','leg_hit'])
  for mode in ['overlapping','sequential']:
   for variant,data in results[mode].items():
    for t in data['tickets']:
     for i in t['legs']:
      l=s.L[i];w.writerow([mode,variant,t['start'],t['odd'],t['hit'],t['book'],l['day'],l['home'],l['away'],l['market'],l['odd'],l['score'],l['hit']])
 print(json.dumps({mode:{v:{'summary':data['summary'],'skipped':data['skipped']}for v,data in results[mode].items()}for mode in ['overlapping','sequential']},ensure_ascii=False,indent=2))
 return results
if __name__=='__main__':run()
