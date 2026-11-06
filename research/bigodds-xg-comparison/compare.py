"""Fixed-rule paired replay of the original 6/11 research candidate.
No parameter search; no production writes. xG weight fixed at 25% before replay.
"""
import json,math,datetime,collections,sys,csv,hashlib
from pathlib import Path
ROOT=Path(__file__).parent
BASE=ROOT.parent/'bigodds-wide'
sys.path.insert(0,str(BASE));import base as b
L=json.loads((BASE/'legs.json').read_text());POOL=json.loads((BASE/'pool.json').read_text())
SOURCES=json.loads((BASE/'model-sources.json').read_text());baseline_source=SOURCES.index('goals4')
REFERENCE=json.loads((BASE/'results.json').read_text())['hindsight_only']['2']
M={'1':0,'2':2,'1X':3,'X2':4,'1+O15':5,'2+O15':6,'1X+O15':7,'X2+O15':8,'O15':11,'U15':12,'O25':13,'U25':14,'O35':15,'U35':16,'BY':19,'BN':20}
WEIGHT=.25;PRIOR=4;ROLE_MIN=4;LEAGUE_MIN=20

def xg_stats(cut,strict):
 league=collections.defaultdict(lambda:[0.,0.,0.,0]);team=collections.defaultdict(lambda:[0.,0.,0.,0]);used=[]
 def add(mapping,key,w,gf,ga):
  s=mapping[key];s[0]+=w;s[1]+=w*gf;s[2]+=w*ga;s[3]+=1
 for fid,d in b.D.items():
  f=b.FD[fid];completed=f[2]+7200000
  if completed>cut or (strict and d[2]>cut) or not b.validpair(d[9],d[10],20):continue
  w=math.exp(-(cut-completed)/b.DECAY)
  add(league,(f[1],0),w,d[9],d[10]);add(league,(f[1],1),w,d[10],d[9])
  add(team,(f[1],f[3],0),w,d[9],d[10]);add(team,(f[1],f[4],1),w,d[10],d[9])
  used.append((fid,completed,d[2]))
 return league,team,used

def prediction(f,cut,stats):
 league,team,used=stats;lg=f[1];home=f[3];away=f[4]
 lh=b.L[(lg,0)].at(cut);la=b.L[(lg,1)].at(cut);h=b.T[(lg,home,0)].at(cut);a=b.T[(lg,away,1)].at(cut)
 bh=(lh[1]+30)/(lh[0]+20);ba=(la[1]+24)/(la[0]+20)
 gh=bh*((h[1]+4*bh)/(h[0]+4)/bh)*((a[2]+4*bh)/(a[0]+4)/bh)
 ga=ba*((a[1]+4*ba)/(a[0]+4)/ba)*((h[2]+4*ba)/(h[0]+4)/ba)
 xl=league[(lg,0)];xr=league[(lg,1)];xh=team[(lg,home,0)];xa=team[(lg,away,1)]
 active=xh[0]>=ROLE_MIN and xa[0]>=ROLE_MIN and xl[0]>=LEAGUE_MIN and xr[0]>=LEAGUE_MIN
 mxh=gh;mxa=ga
 if active:
  bxh=xl[1]/xl[0];bxa=xr[1]/xr[0]
  active=min(bxh,bxa)>0
  if active:
   xgh=bh*((xh[1]+4*bxh)/(xh[0]+4)/bxh)*((xa[2]+4*bxh)/(xa[0]+4)/bxh)
   xga=ba*((xa[1]+4*bxa)/(xa[0]+4)/bxa)*((xh[2]+4*bxa)/(xh[0]+4)/bxa)
   mxh=(1-WEIGHT)*gh+WEIGHT*xgh;mxa=(1-WEIGHT)*ga+WEIGHT*xga
 return {'baseline':b.distribution(gh,ga),'probabilities':b.distribution(mxh,mxa),'active':bool(active),'goals':[gh,ga],'blended_goals':[mxh,mxa],'xg_role_raw':[xh[3],xa[3]],'xg_role_weighted':[xh[0],xa[0]],'xg_league_weighted':[xl[0],xr[0]],'max_xg_observed':max((x[2] for x in used),default=0),'max_xg_completion':max((x[1] for x in used),default=0)}

def rebuild_probabilities():
 predictions={};idx=0
 decisions=sorted(set(l['decision'] for l in L))
 for cut in decisions:
  while idx<len(b.F) and b.F[idx][2]+7200000<=cut:
   f=b.F[idx];b.update(f,f[2]+7200000);idx+=1
  stats={'available':xg_stats(cut,True),'retrospective':xg_stats(cut,False)}
  targets={l['id'] for l in L if l['decision']==cut}
  for fid in sorted(targets):
   f=b.FD[fid]
   predictions[(cut,fid)]={mode:prediction(f,cut,st) for mode,st in stats.items()}
 for l in L:
  p=predictions[(l['decision'],l['id'])]['available']['baseline'][M[l['market']]]
  assert abs(p-l['ps'][baseline_source])<1e-11,('baseline reconstruction mismatch',l['id'],l['market'],p,l['ps'][baseline_source])
 return predictions

def replay(P,real_only=False):
 tickets=[]
 for day,books in sorted(POOL.items()):
  last=(datetime.date.fromisoformat(day)+datetime.timedelta(days=1)).isoformat()
  if last>'2026-11-04':continue
  best=None
  for book,groups in books.items():
   selected=[]
   for group in groups:
    if L[group[0]]['day']>last:continue
    eligible=[i for i in group if P[i]>=.5 and L[i]['odd']>=1.2 and L[i]['sample']>=0 and not(real_only and L[i]['estimated'])]
    if eligible:selected.append(max(eligible,key=lambda i:(P[i],P[i],-i)))
   selected.sort(key=lambda i:(-P[i],-P[i],i))
   lp=lo=0.;prefix=[]
   for n,i in enumerate(selected[:12],1):
    lp+=math.log(max(P[i],1e-15));lo+=math.log(L[i]['odd']);prefix.append(i)
    if lo>math.log(15)+1e-12:break
    odd=math.exp(lo)
    if 5<=n<=12 and 8<=odd<=15+1e-10 and (best is None or lp>best[0]):best=(lp,odd,prefix.copy(),book)
  if best:
   lp,odd,ids,book=best;tickets.append({'start':day,'last':last,'book':book,'odd':odd,'p':math.exp(lp),'legs':ids,'hit':int(all(L[i]['hit'] for i in ids)),'estimated':any(L[i]['estimated'] for i in ids)})
 return tickets

def aggregate(ts):
 return {'tickets':len(ts),'wins':sum(t['hit'] for t in ts),'rate':sum(t['hit'] for t in ts)/len(ts) if ts else None,'mean_odd':sum(t['odd'] for t in ts)/len(ts) if ts else None,'mean_legs':sum(len(t['legs']) for t in ts)/len(ts) if ts else None,'estimated_price_tickets':sum(t['estimated'] for t in ts)}

def run():
 predictions=rebuild_probabilities();vectors={'goals4':[l['ps'][baseline_source] for l in L]}
 for mode in ['available','retrospective']:vectors['goals4_xg25_'+mode]=[predictions[(l['decision'],l['id'])][mode]['probabilities'][M[l['market']]] for l in L]
 replays={name:replay(P) for name,P in vectors.items()}
 for a,z in zip(replays['goals4'],REFERENCE['tickets']):
  assert a['start']==z['start'] and a['legs']==z['legs'] and a['hit']==z['hit'] and abs(a['odd']-z['odd'])<1e-10
 assert len(replays['goals4'])==11 and sum(t['hit'] for t in replays['goals4'])==6
 rows=[]
 for day in [t['start'] for t in replays['goals4']]:
  row={'day':day}
  for name,ts in replays.items():
   t=next((t for t in ts if t['start']==day),None)
   row[name]=None if t is None else {'won':t['hit'],'odd':t['odd'],'legs':len(t['legs']),'changed_selections':len(set((L[i]['id'],L[i]['market']) for i in t['legs'])^set((L[i]['id'],L[i]['market']) for i in next(x for x in replays['goals4'] if x['start']==day)['legs']))}
  rows.append(row)
 coverage={mode:{'fixture_windows':len(predictions),'xg_active':sum(p[mode]['active'] for p in predictions.values())} for mode in ['available','retrospective']}
 for name,ts in replays.items():
  mode='available' if name.endswith('available') else 'retrospective'
  for t in ts:
   t['xg_active_legs']=sum(predictions[(L[i]['decision'],L[i]['id'])][mode]['active'] for i in t['legs']) if name!='goals4' else 0
 results={'protocol':{'rule':REFERENCE['rule'],'weight':WEIGHT,'prior':PRIOR,'minimum_weighted_xg_role_games':ROLE_MIN,'minimum_weighted_xg_league_games':LEAGUE_MIN,'availability_main':'xG completed before decision AND observed_at <= decision; decayed by match time, not import time','retrospective_sensitivity':'xG from earlier finished games ignoring import timestamp; not a verified historical availability replay','clock':'08h Europe/Lisbon on first day; old baseline result availability assumed kickoff+2h as original study','candidate_selection':'Original goals4 rule frozen after full-period search; no search or tuning here','overlap':'Original overlapping two-day windows retained for exact comparison; not current sequential/three-day production policy','prices':'Original archived odds and synthetic combo estimates held identical across variants; real-only sensitivity provided','production_changes':False},'summary':{name:aggregate(ts) for name,ts in replays.items()},'coverage':coverage,'per_day':rows,'tickets':replays,'real_only':{name:{'summary':aggregate(replay(P,True)),'tickets':replay(P,True)} for name,P in vectors.items()}}
 (ROOT/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
 (ROOT/'predictions.json').write_text(json.dumps([{'decision':cut,'fixture':fid,**p} for (cut,fid),p in predictions.items()],ensure_ascii=False,separators=(',',':')))
 # Keep exact leg snapshots, including quote clocks and outcomes, for review.
 (ROOT/'legs.json').write_text(json.dumps(L,ensure_ascii=False,separators=(',',':')))
 with (ROOT/'tickets.csv').open('w',newline='') as out:
  w=csv.writer(out);w.writerow(['variant','decision_day','book','total_odd','ticket_won','fixture','match_day','home','away','market','odd','score','leg_hit','estimated_price','xg_active'])
  for name,ts in replays.items():
   mode='available' if name.endswith('available') else 'retrospective'
   for t in ts:
    for i in t['legs']:
     l=L[i];w.writerow([name,t['start'],t['book'],t['odd'],t['hit'],l['id'],l['day'],l['home'],l['away'],l['market'],l['odd'],l['score'],l['hit'],l['estimated'],False if name=='goals4' else predictions[(l['decision'],l['id'])][mode]['active']])
 print(json.dumps({'summary':results['summary'],'coverage':coverage,'real_only':{k:v['summary'] for k,v in results['real_only'].items()},'per_day':rows},ensure_ascii=False,indent=2))
 return results
if __name__=='__main__':run()
