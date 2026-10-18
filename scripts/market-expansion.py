"""Bounded nested retrospective comparison; no production changes from this script."""
import json,pathlib,datetime
from zoneinfo import ZoneInfo
from importlib.machinery import SourceFileLoader
import numpy as np
R=pathlib.Path(__file__).resolve().parents[1]
D=SourceFileLoader('daily_market',str(R/'scripts/daily-market.py')).load_module();W=D.W
protocol=json.loads((R/'scripts/market-expansion-protocol.json').read_text())
keys=D.keys+['HO05','AO05','HO15','AO15','O05','U45','HU15','AU15','HU25','AU25','HAP15','AAP15']
extra=[]
for c in range(4):
 J,_,_=W.T.distribution(D.M.B[:,c,:]);h,a=np.indices((23,23))
 extra.append(np.column_stack([J[:,h>=1].sum(1),J[:,a>=1].sum(1),J[:,h>=2].sum(1),J[:,a>=2].sum(1),J[:,h+a>=1].sum(1),J[:,h+a<=4].sum(1),J[:,h<=1].sum(1),J[:,a<=1].sum(1),J[:,h<=2].sum(1),J[:,a<=2].sum(1),J[:,h+1.5>a].sum(1),J[:,a+1.5>h].sum(1)]))
PP=np.concatenate([D.PP,np.stack(extra,axis=1)],axis=2)
h,a=W.y[:,0],W.y[:,1]
YY=np.column_stack([D.YY,h>=1,a>=1,h>=2,a>=2,h+a>=1,h+a<=4,h<=1,a<=1,h<=2,a<=2,h+1.5>a,a+1.5>h]).astype(int)
policies=[{'id':f'{family}-{p["cap"]}-{p["extraMinProbability"]}', 'markets':family,**p} for p in protocol['listPolicies'] for family in protocol['marketSets']]
baseline=policies[0]
def groups(season,weights):
 ix=np.flatnonzero(W.S==season);P=np.einsum('nmc,m->nc',PP[ix],weights);days={}
 for j,i in enumerate(ix):
  k=0 if P[j,0]>P[j,2] else 2
  if P[j,k]<.5 or P[j,k]<=P[j,1] or P[j,k]<=P[j,2 if k==0 else 0]:continue
  row=W.rows[i];day=datetime.datetime.fromtimestamp(row['ts']/1000,ZoneInfo('Europe/Lisbon')).date().isoformat()
  days.setdefault(day,[]).append({'i':int(i),'day':day,'id':row['id'],'league':row['league'],'ts':row['ts'],'k':k,'p':P[j].tolist()})
 return {d:sorted(rs,key=lambda r:(-r['p'][r['k']],r['ts'],r['id'])) for d,rs in sorted(days.items())}
def choose(days,policy):
 out=[]
 for day,rs in days.items():
  rs=rs[:3]+[r for r in rs[3:policy['cap']] if r['p'][r['k']]>=policy['extraMinProbability']]
  best=None
  for j,r in enumerate(rs):
   allowed=[3 if r['k']==0 else 4]
   if policy['markets']!='draw':allowed+=list(range(5,13))
   if policy['markets'] in ['team-goals','broad-goals']:allowed+=[13 if r['k']==0 else 14,15 if r['k']==0 else 16]
   if policy['markets']=='broad-goals':allowed+=list(range(17,23))+[23 if r['k']==0 else 24]
   for k in allowed:
    gain=r['p'][k]-r['p'][r['k']]
    if gain>0 and (best is None or gain>best[0]):best=(gain,j,k)
  for j,r in enumerate(rs):
   k=best[2] if best and j==best[1] else r['k']
   out.append({**r,'market':keys[k],'probability':r['p'][k],'y':int(YY[r['i'],k]),'alternative':k!=r['k'],'extra':j>=3})
 return out
def metrics(rs):
 if not rs:return {'n':0,'wins':0,'hitRate':None}
 p=np.array([r['probability'] for r in rs]);y=np.array([r['y'] for r in rs]);n=len(rs)
 return {'n':n,'wins':int(y.sum()),'hitRate':float(y.mean()),'meanProbability':float(p.mean()),'brier':float(((p-y)**2).mean()),'logLoss':float(-(y*np.log(p)+(1-y)*np.log(1-p)).mean()),'alternatives':sum(r['alternative'] for r in rs),'byMarket':{k:{'n':sum(r['market']==k for r in rs),'wins':sum(r['y'] for r in rs if r['market']==k)} for k in keys if any(r['market']==k for r in rs)},'byLeague':{str(k):{'n':sum(r['league']==k for r in rs),'wins':sum(r['y'] for r in rs if r['league']==k)} for k in sorted(set(r['league'] for r in rs))}}
def compare(bs,cs):
 days=sorted(set(r['day'] for r in bs)|set(r['day'] for r in cs));B=np.array([[sum(r['y'] for r in bs if r['day']==d),sum(r['day']==d for r in bs)] for d in days]);C=np.array([[sum(r['y'] for r in cs if r['day']==d),sum(r['day']==d for r in cs)] for d in days]);rng=np.random.default_rng(20261021);diff=[];rates=[]
 for _ in range(2000):
  ix=rng.integers(0,len(days),len(days));b=B[ix].sum(0);c=C[ix].sum(0);diff.append(c[0]/c[1]-b[0]/b[1]);rates.append(c[0]/c[1])
 return {'baseline':metrics(bs),'candidate':metrics(cs),'pairedDayBootstrap95':np.quantile(diff,[.025,.975]).tolist(),'hitRateDayBootstrap95':np.quantile(rates,[.025,.975]).tolist(),'days':len(days)}
def run():
 folds=[];allbase=[];allcand=[];allsame=[];golden=[]
 for f in D.report['folds']:
  season=f['season'];pw=next(c['weights'] for c in f['candidates'] if c['id']==f['selected']);dev=groups(season-1,pw)
  candidates=[{'policy':p,'metrics':metrics(choose(dev,p))} for p in policies]
  chosen=max(candidates,key=lambda c:c['metrics']['hitRate'])['policy']
  days=groups(season,f['weights']);bs=choose(days,baseline);cs=choose(days,chosen);same=choose(days,{**chosen,'cap':3})
  assert set(r['id'] for r in bs)<=set(r['id'] for r in cs)
  assert all(sum(r['alternative'] for r in cs if r['day']==d)<=1 for d in days)
  folds.append({'season':season,'selected':chosen,'development':candidates,**compare(bs,cs),'sameMarketCap3':metrics(same),'extraGames':metrics([r for r in cs if r['extra']])})
  allbase+=bs;allcand+=cs;allsame+=same
  seen=set()
  for d in days:
   selected=choose({d:days[d]},{**chosen,'cap':3});alt=next(r['market'] for r in selected if r['alternative'])
   if alt in seen and not (len(days[d])>3 and 'busy' not in seen):continue
   seen.add(alt)
   if len(days[d])>3:seen.add('busy')
   games=[{**r,'components':[{'weight':float(weight),'homeGoals':float(D.M.B[r['i'],c,0]),'awayGoals':float(D.M.B[r['i'],c,1])} for c,weight in enumerate(f['weights']) if weight>0]} for r in days[d]]
   golden.append({'day':d,'games':games,'selected':[{k:r[k] for k in ['id','market','probability']} for r in selected]})
 comparison=compare(allbase,allcand);expansion=compare(allsame,allcand)
 passed=comparison['pairedDayBootstrap95'][0]>0 and all(f['candidate']['hitRate']>=f['baseline']['hitRate'] and f['candidate']['n']>=f['baseline']['n'] for f in folds)
 expanded=passed and expansion['candidate']['n']>expansion['baseline']['n'] and expansion['pairedDayBootstrap95'][0]>0 and all(f['candidate']['hitRate']>=f['sameMarketCap3']['hitRate'] for f in folds)
 # If volume expansion fails its separate gate, assess the selected family on the original three.
 capped=compare(allbase,allsame);marketPassed=capped['pairedDayBootstrap95'][0]>0 and all(f['sameMarketCap3']['hitRate']>=f['baseline']['hitRate'] for f in folds)
 live={**folds[-1]['selected']};promoted=passed if expanded else marketPassed
 if not expanded:live['cap']=3;live['extraMinProbability']=.5
 if not promoted:live=baseline
 live['id']=f"{live['markets']}-{live['cap']}-{live['extraMinProbability']}"
 result={'version':'market-expansion-v1','datasetHash':D.report['datasetHash'],'protocol':protocol,'folds':folds,'pooled':comparison,'volumeImpact':expansion,'cap3MarketImpact':capped,'promoted':promoted,'expanded':expanded,'activePolicy':live}
 (R/'src/market-expansion-research.json').write_text(json.dumps(result,indent=2)+'\n')
 (R/'tests/market-expansion-golden.json').write_text(json.dumps(golden)+'\n')
 print(json.dumps({k:result[k] for k in ['pooled','volumeImpact','cap3MarketImpact','promoted','expanded','activePolicy']},indent=2))
if __name__=='__main__':run()
