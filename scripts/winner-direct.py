"""Nested chronological 1X2 learner. Nine fixed candidates plus current baseline."""
import json,pathlib,datetime
from zoneinfo import ZoneInfo
import numpy as np
from scipy.optimize import minimize
from scipy.special import softmax
from importlib.machinery import SourceFileLoader
R=pathlib.Path(__file__).resolve().parents[1]
T=SourceFileLoader('luxg_train',str(R/'scripts/luxg-train.py')).load_module()
rows=sorted([r for r in T.D['rows'] if r['sample']>=12],key=lambda r:r['ts'])
_,base,y=T.matrices(rows);_,P,_=T.distribution(base);Y=np.where(y[:,0]>y[:,1],0,np.where(y[:,0]==y[:,1],1,2));O=np.eye(3)[Y];L=np.log(P)
F=np.array([r['features'] for r in rows]);X=np.column_stack([np.ones(len(rows)),L,F[:,0,4],F[:,0,5]-F[:,1,5],F[:,0,6]-F[:,1,6],F[:,0,7]-F[:,1,7],F[:,0,8]-F[:,1,8],F[:,0,9],F[:,0,10:]])
names=['intercept','logPH','logPD','logPA','eloAdvantage','recentAttackDiff','opponentDefenseDiff','venueAttackDiff','venueDefenseDiff','restAdvantage','league39','league61','league78','league94','league135','league140']
panels={'calibration':list(range(4)),'strength':list(range(5))+list(range(10,16)),'context':list(range(16))}
S=np.array([r['season'] for r in rows]);ts=np.array([r['ts'] for r in rows]);cut=np.array([r['cutoff'] for r in rows])

def fit(indices,alpha,ix):
 raw=X[ix][:,indices];c=raw.mean(0);s=raw.std(0);s[s<1e-8]=1;c[0]=0;s[0]=1;Z=(raw-c)/s
 penalty=np.ones((len(indices),3));penalty[0]=.1
 def objective(flat):
  beta=flat.reshape(-1,3);z=L[ix]+Z@beta;p=softmax(z,axis=1)
  loss=-np.log(p[np.arange(len(ix)),Y[ix]]).mean()+alpha/2*np.sum(penalty*beta**2)
  grad=Z.T@(p-O[ix])/len(ix)+alpha*penalty*beta
  return loss,grad.ravel()
 result=minimize(objective,np.zeros(len(indices)*3),jac=True,method='L-BFGS-B',bounds=[(-1.5,1.5)]*(len(indices)*3),options={'ftol':1e-12,'gtol':1e-8,'maxiter':1000})
 if not result.success:raise RuntimeError(result.message)
 return {'indices':indices,'center':c.tolist(),'scale':s.tolist(),'coefficients':result.x.reshape(-1,3).tolist(),'ridge':alpha}
def apply(params,ix):
 if params is None:return P[ix].copy()
 return softmax(L[ix]+((X[ix][:,params['indices']]-params['center'])/params['scale'])@np.array(params['coefficients']),axis=1)
def metrics(Q,ix):
 n=len(ix);p=Q.max(1);hit=Q.argmax(1)==Y[ix]
 ece=sum(abs(float(p[(p>=k/10)&(p<(k+1)/10)].sum())-float(hit[(p>=k/10)&(p<(k+1)/10)].sum())) for k in range(10))/n
 return {'n':n,'logLoss':float(-np.log(Q[np.arange(n),Y[ix]]).mean()),'brier':float(np.sum((Q-O[ix])**2,axis=1).mean()),'accuracy':float(hit.mean()),'ece':ece}
def tips(Q,ix):
 days={}
 for j,i in enumerate(ix):
  k=0 if Q[j,0]>Q[j,2] else 2;p=float(Q[j,k])
  if p<.5 or p<=Q[j,1] or p<=Q[j,2 if k==0 else 0]:continue
  day=datetime.datetime.fromtimestamp(rows[i]['ts']/1000,ZoneInfo('Europe/Lisbon')).date().isoformat()
  days.setdefault(day,[]).append({'id':rows[i]['id'],'p':p,'y':int(Y[i]==k),'ts':rows[i]['ts']})
 selected=[x for day in sorted(days) for x in sorted(days[day],key=lambda x:(-x['p'],x['ts'],x['id']))[:3]]
 n=len(selected);w=sum(r['y'] for r in selected)
 return {'n':n,'wins':w,'hitRate':w/n if n else None,'meanProbability':sum(r['p'] for r in selected)/n if n else None}
def select(target):
 dev=np.flatnonzero(S==target-1);start=cut[dev].min();train=np.flatnonzero((S<target-1)&(ts+7200000<start))
 candidates=[{'id':'baseline','params':None,'development':metrics(P[dev],dev)}]
 for panel,indices in panels.items():
  for alpha in [.01,.1,1]:
   p=fit(indices,alpha,train);candidates.append({'id':panel+'-'+str(alpha),'panel':panel,'params':p,'development':metrics(apply(p,dev),dev)})
 winner=min(candidates,key=lambda c:c['development']['logLoss'])
 test=np.flatnonzero(S==target);train=np.flatnonzero((S<target)&(ts+7200000<cut[test].min()))
 refit=fit(winner['params']['indices'],winner['params']['ridge'],train) if winner['params'] else None
 return test,refit,candidates,winner['id'],len(train)
def run():
 results=[];indices=[];predictions=[]
 for target in [2025,2026]:
  ix,params,candidates,winner,n=select(target);Q=apply(params,ix)
  results.append({'season':target,'trainMatches':n,'selected':winner,'selection':candidates,'params':params,'baseline':metrics(P[ix],ix),'candidate':metrics(Q,ix),'baselineTips':tips(P[ix],ix),'candidateTips':tips(Q,ix)})
  indices.extend(ix);predictions.extend(Q)
 ix=np.array(indices);Q=np.array(predictions);diff=-np.log(P[ix,np.array(Y[ix])])+np.log(Q[np.arange(len(ix)),Y[ix]])
 weeks={}
 for j,i in enumerate(ix):
  k=datetime.datetime.fromtimestamp(rows[i]['ts']/1000,datetime.timezone.utc).isocalendar()[:2];weeks.setdefault(k,[]).append(j)
 blocks=list(weeks.values());rng=np.random.default_rng(20261019)
 boots=[float(diff[np.concatenate([blocks[k] for k in rng.integers(0,len(blocks),len(blocks))])].mean()) for _ in range(2000)]
 ci=np.quantile(boots,[.025,.975]).tolist();bm=metrics(P[ix],ix);qm=metrics(Q,ix);bt=tips(P[ix],ix);qt=tips(Q,ix)
 promoted=ci[0]>0 and qm['brier']<=bm['brier'] and qt['hitRate']>=bt['hitRate'] and all(r['candidate']['logLoss']<r['baseline']['logLoss'] for r in results)
 report={'version':'winner-direct-v1','datasetHash':T.D['datasetHash'],'protocol':json.loads((R/'scripts/winner-direct-protocol.json').read_text()),'features':names,'folds':results,'pooled':{'baseline':bm,'candidate':qm,'baselineTips':bt,'candidateTips':qt,'logLossImprovement':float(diff.mean()),'weekBootstrap95':ci,'weeks':len(blocks)},'promoted':promoted}
 (R/'src/winner-direct-research.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({'folds':[{k:r[k] for k in ['season','selected','baseline','candidate','baselineTips','candidateTips']} for r in results],'pooled':report['pooled'],'promoted':promoted},indent=2),flush=True)
if __name__=='__main__':run()
