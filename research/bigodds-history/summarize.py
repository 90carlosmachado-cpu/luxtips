import json,math,datetime,collections,random
from pathlib import Path
from zoneinfo import ZoneInfo
import numpy as np
ROOT=Path(__file__).parent;TZ=ZoneInfo('Europe/Lisbon')
MODELS=['league','goals8','goals4','goals8_elo20','goals8_sot25','goals8_xg25']
KEYS=['H','D','A','HX','XA','HO','AO','HXO','XAO']
R=json.loads((ROOT/'predictions.json').read_text())
def game_day(r):return datetime.datetime.fromtimestamp(r['kickoff']/1000,TZ).date().isoformat()
canonical=[r for r in R if r['start']==game_day(r) and r['sample']>=12]
assert len({r['id'] for r in canonical})==len(canonical)

def outcomes(r):
 h,a=r['hg'],r['ag'];H=int(h>a);D=int(h==a);A=int(a>h);O=int(h+a>=2)
 return [H,D,A,H+D,A+D,H*O,A*O,(H+D)*O,(A+D)*O]

def metric(rows,m):
 if not rows:return {'n':0}
 P=np.array([r['ps'][m] for r in rows]);Y=np.array([outcomes(r) for r in rows]);p3=P[:,:3];y3=Y[:,:3]
 winidx=np.where(P[:,0]>=P[:,2],0,2);winp=P[np.arange(len(rows)),winidx];winy=Y[np.arange(len(rows)),winidx]
 dcidx=np.where(P[:,3]>=P[:,4],3,4);dcp=P[np.arange(len(rows)),dcidx];dcy=Y[np.arange(len(rows)),dcidx]
 def subset(p,y,threshold):
  mask=p>=threshold;n=int(mask.sum());return {'n':n,'hits':int(y[mask].sum()),'rate':float(y[mask].mean()) if n else None,'mean_p':float(p[mask].mean()) if n else None}
 return {'n':len(rows),'logloss':float(-np.log(np.clip(p3[y3.astype(bool)],1e-15,1)).mean()),'brier':float(((p3-y3)**2).sum(axis=1).mean()),'accuracy_1x2':float((p3.argmax(axis=1)==y3.argmax(axis=1)).mean()),'win65':subset(winp,winy,.65),'win70':subset(winp,winy,.70),'dc80':subset(dcp,dcy,.8),'markets':{key:{'brier':float(((P[:,i]-Y[:,i])**2).mean()),'p70':subset(P[:,i],Y[:,i],.7)} for i,key in enumerate(KEYS) if key!='D'}}

train=[r for r in canonical if r['start'].startswith('2024')]
training={name:metric(train,i) for i,name in enumerate(MODELS)}
choice=min(MODELS[1:5],key=lambda name:training[name]['logloss']);selected=MODELS.index(choice)
(ROOT/'choice-from-2024.json').write_text(json.dumps({'choice':choice,'selection_rule':'lowest multiclass logloss in calendar2024 among four non-xG candidates','training':training},indent=2))
print('CHOICE',choice,flush=True)
report={'protocol':json.loads((ROOT/'protocol.json').read_text()),'choice_from_2024':choice,'training_2024':training,'periods':{},'tickets_probability_only':[]}
for year in [2025,2026]:
 rows=[r for r in canonical if r['start'].startswith(str(year))]
 report['periods'][str(year)]={'all':{name:metric(rows,i) for i,name in enumerate(MODELS)},'by_league_selected':{str(l):metric([r for r in rows if r['league']==l],selected) for l in sorted({r['league'] for r in rows})},'paired_sot_active':{'n':sum(r['sot_active'] for r in rows),'goals8':metric([r for r in rows if r['sot_active']],1),'goals8_sot25':metric([r for r in rows if r['sot_active']],4)},'paired_xg_active':{'n':sum(r['xg_active'] for r in rows),'goals8':metric([r for r in rows if r['xg_active']],1),'goals8_xg25':metric([r for r in rows if r['xg_active']],5)}}
 # Paired differences, resample entire day clusters, not individual markets.
 groups=collections.defaultdict(list)
 for r in rows:
  y=outcomes(r)[:3];b=[sum((r['ps'][m][i]-y[i])**2 for i in range(3)) for m in [1,selected]];groups[r['start']].append(b[1]-b[0])
 sums=np.array([sum(a) for a in groups.values()]);counts=np.array([len(a) for a in groups.values()]);rng=np.random.default_rng(20261105);bs=[]
 for _ in range(2000):
  idx=rng.integers(0,len(sums),len(sums));bs.append(sums[idx].sum()/counts[idx].sum())
 report['periods'][str(year)]['selected_minus_goals8_brier']={'difference':float(sums.sum()/counts.sum()),'day_cluster_bootstrap95':np.quantile(bs,[.025,.975]).tolist(),'day_clusters':len(groups)}
 print(json.dumps({'year':year,'n':len(rows),'metrics':{name:{'ll':metric(rows,i)['logloss'],'brier':metric(rows,i)['brier'],'win65':metric(rows,i)['win65']} for i,name in enumerate(MODELS)}}),flush=True)

# Probability-only ticket diagnostics; NEVER label these odds8–15 simulations.
# Per-family comparison avoids DC mechanically dominating every narrower event
# when there are no historical prices with which to compare tradeoffs.
family={'win':[0,2],'dc':[3,4],'win_O15':[5,6],'dc_O15':[7,8]}
byday=collections.defaultdict(list)
for r in R:
 if r['sample']>=12 and r['start'][:4] in ['2025','2026']:byday[r['start']].append(r)
lastdate={'2025':'2025-12-31','2026':'2026-10-21'}
for year in ['2025','2026']:
 for span in [2,3]:
  for fam,indices in family.items():
   for nlegs in [5,8,9,12]:
    tickets=[]
    for start,rows in sorted(byday.items()):
     if start[:4]!=year:continue
     last=(datetime.date.fromisoformat(start)+datetime.timedelta(days=span-1)).isoformat()
     if last>lastdate[year]:continue
     candidates=[]
     for r in rows:
      if game_day(r)>last:continue
      idx=max(indices,key=lambda k:r['ps'][selected][k]);p=r['ps'][selected][idx]
      if p<.5:continue
      candidates.append((p,r['id'],idx,r))
     candidates.sort(key=lambda c:(-c[0],c[1]));used=set();chosen=[]
     for p,fid,idx,r in candidates:
      if r['home'] in used or r['away'] in used:continue
      chosen.append((p,fid,idx,r));used.update([r['home'],r['away']])
      if len(chosen)==nlegs:break
     if len(chosen)<nlegs:continue
     prob=math.prod(c[0] for c in chosen);hits=[outcomes(c[3])[c[2]] for c in chosen]
     tickets.append({'start':start,'ids':[c[1] for c in chosen],'markets':[KEYS[c[2]] for c in chosen],'p':prob,'hit':int(all(hits)),'leg_hits':sum(hits)})
    count=len(tickets);anchor=datetime.date(int(year),1,1);non=[t for t in tickets if (datetime.date.fromisoformat(t['start'])-anchor).days%span==0]
    report['tickets_probability_only'].append({'year':year,'span':span,'family':fam,'nlegs':nlegs,'tickets':count,'wins':sum(t['hit'] for t in tickets),'mean_p':sum(t['p'] for t in tickets)/count if count else None,'nonoverlap':{'n':len(non),'wins':sum(t['hit'] for t in non)},'details':tickets,'odds':None,'roi':None})
(ROOT/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print('COMPLETED',flush=True)
