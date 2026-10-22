import json,pathlib,datetime
from zoneinfo import ZoneInfo
from importlib.machinery import SourceFileLoader
import numpy as np
R=pathlib.Path(__file__).resolve().parents[1]
M=SourceFileLoader('winner_multiscale',str(R/'scripts/winner-multiscale.py')).load_module();W=M.W
report=json.loads((R/'src/winner-multiscale-research.json').read_text())
keys=['H','D','A','HX','XA','O15','U15','O25','U25','O35','U35','BY','BN']
components=[]
for c in range(4):
 J,P,_=W.T.distribution(M.B[:,c,:]);h,a=np.indices((23,23));o15=J[:,h+a>=2].sum(1);o25=J[:,h+a>=3].sum(1);o35=J[:,h+a>=4].sum(1);by=J[:,(h>0)&(a>0)].sum(1)
 components.append(np.column_stack([P,P[:,0]+P[:,1],P[:,2]+P[:,1],o15,1-o15,o25,1-o25,o35,1-o35,by,1-by]))
PP=np.stack(components,axis=1);h=W.y[:,0];a=W.y[:,1]
YY=np.column_stack([h>a,h==a,h<a,h>=a,a>=h,h+a>=2,h+a<2,h+a>=3,h+a<3,h+a>=4,h+a<4,(h>0)&(a>0),(h==0)|(a==0)]).astype(int)
def groups(season,weights):
 ix=np.flatnonzero(W.S==season);P=np.einsum('nmc,m->nc',PP[ix],weights);days={}
 for j,i in enumerate(ix):
  k=0 if P[j,0]>P[j,2] else 2
  if P[j,k]<.5 or P[j,k]<=P[j,1] or P[j,k]<=P[j,2 if k==0 else 0]:continue
  day=datetime.datetime.fromtimestamp(W.rows[i]['ts']/1000,ZoneInfo('Europe/Lisbon')).date().isoformat()
  days.setdefault(day,[]).append({'i':int(i),'day':day,'id':W.rows[i]['id'],'ts':W.rows[i]['ts'],'k':k,'p':P[j].tolist()})
 return {d:sorted(rs,key=lambda r:(-r['p'][r['k']],r['ts'],r['id']))[:3] for d,rs in sorted(days.items())}
def choose(days,policy):
 out=[]
 for day,rs in days.items():
  best=None
  if policy!='winner-only':
   for j,r in enumerate(rs):
    allowed=[3 if r['k']==0 else 4]+(list(range(5,13)) if policy=='largest-probability-gain' else [])
    for k in allowed:
     gain=r['p'][k]-r['p'][r['k']]
     if gain>0 and (best is None or gain>best[0]):best=(gain,j,k)
  for j,r in enumerate(rs):
   k=best[2] if best and j==best[1] else r['k'];i=r['i']
   out.append({**r,'market':keys[k],'probability':r['p'][k],'y':int(YY[i,k]),'baselineY':int(YY[i,r['k']]),'baselineP':r['p'][r['k']],'alternative':k!=r['k']})
 return out
def summary(rs):
 n=len(rs);w=sum(r['y'] for r in rs);p=np.array([r['probability'] for r in rs]);y=np.array([r['y'] for r in rs]);return {'n':n,'wins':w,'hitRate':w/n,'days':len(set(r['day'] for r in rs)),'alternatives':sum(r['alternative'] for r in rs),'meanProbability':float(p.mean()),'brier':float(((p-y)**2).mean()),'logLoss':float(-(y*np.log(p)+(1-y)*np.log(1-p)).mean()),'byMarket':{k:{'n':len([r for r in rs if r['market']==k]),'wins':sum(r['y'] for r in rs if r['market']==k)} for k in keys if any(r['market']==k for r in rs)}}
def run():
 policies=['winner-only','draw-protection','largest-probability-gain'];folds=[];allrows=[]
 for f in report['folds']:
  season=f['season']
  # Weights fitted before the selection season: stored development candidates, not final refit weights.
  priorWeights=next(c['weights'] for c in f['candidates'] if c['id']==f['selected'])
  dev=groups(season-1,priorWeights);scores=[{'policy':p,'metrics':summary(choose(dev,p))} for p in policies]
  chosen=max(scores,key=lambda x:x['metrics']['hitRate'])['policy']
  test=groups(season,f['weights']);selected=choose(test,chosen);base=choose(test,'winner-only')
  assert [r['id'] for r in selected]==[r['id'] for r in base]
  assert all(sum(r['alternative'] for r in selected if r['day']==d)<=1 for d in test)
  folds.append({'season':season,'selected':chosen,'development':scores,'baseline':summary(base),'candidate':summary(selected)});allrows.extend(selected)
 byday={}
 for r in allrows:byday.setdefault(r['day'],[]).append(r)
 blocks=list(byday.values());rng=np.random.default_rng(20261020);diffs=[];rates=[]
 for _ in range(2000):
  rs=[r for k in rng.integers(0,len(blocks),len(blocks)) for r in blocks[k]]
  diffs.append(sum(r['y']-r['baselineY'] for r in rs)/len(rs));rates.append(sum(r['y'] for r in rs)/len(rs))
 ci=np.quantile(diffs,[.025,.975]).tolist();base=[{**r,'y':r['baselineY'],'probability':r['baselineP'],'market':keys[r['k']],'alternative':False} for r in allrows]
 promoted=ci[0]>0 and all(f['candidate']['hitRate']>=f['baseline']['hitRate'] for f in folds)
 result={'version':'daily-market-v1','datasetHash':report['datasetHash'],'protocol':json.loads((R/'scripts/daily-market-protocol.json').read_text()),'folds':folds,'pooled':{'baseline':summary(base),'candidate':summary(allrows),'pairedDayBootstrap95':ci,'hitRateDayBootstrap95':np.quantile(rates,[.025,.975]).tolist()},'promoted':promoted,'activePolicy':folds[-1]['selected'] if promoted else 'winner-only'}
 (R/'src/daily-market-research.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
if __name__=='__main__':run()
