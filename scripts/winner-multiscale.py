"""Development extension: convex pools of recent, medium and long-term strength."""
import json,pathlib,datetime
import numpy as np
from scipy.optimize import minimize
from importlib.machinery import SourceFileLoader
R=pathlib.Path(__file__).resolve().parents[1]
W=SourceFileLoader('winner_direct',str(R/'scripts/winner-direct.py')).load_module()
D=json.loads((R/'data/winner-multiscale.json').read_text());lookup={r['id']:r for r in D['rows']}
B=np.array([lookup[r['id']]['base'] for r in W.rows]);PP=np.stack([W.T.distribution(B[:,i,:])[1] for i in range(4)],axis=1)
assert np.max(np.abs(PP[:,1]-W.P))<1e-12
ref=np.array([0,1,0,0.])
def fit(alpha,ix):
 correct=PP[ix,:,W.Y[ix]]
 def obj(w):
  p=np.maximum(correct@w,1e-12);return float(-np.log(p).mean()+alpha/2*np.sum((w-ref)**2)), -np.mean(correct/p[:,None],axis=0)+alpha*(w-ref)
 result=minimize(obj,ref.copy(),jac=True,method='SLSQP',bounds=[(0,1)]*4,constraints=[{'type':'eq','fun':lambda w:w.sum()-1,'jac':lambda w:np.ones(4)}],options={'maxiter':1000,'ftol':1e-12})
 if not result.success:raise RuntimeError(result.message)
 w=np.clip(result.x,0,1);return w/w.sum()
def apply(w,ix):return np.einsum('nmc,m->nc',PP[ix],w)
def run():
 results=[];indexes=[];predictions=[]
 for target in [2025,2026]:
  dev=np.flatnonzero(W.S==target-1);train=np.flatnonzero((W.S<target-1)&(W.ts+7200000<W.cut[dev].min()))
  candidates=[{'id':'baseline','ridge':None,'weights':ref.tolist(),'development':W.metrics(W.P[dev],dev)}]
  for alpha in [.001,.01,.1]:
   w=fit(alpha,train);candidates.append({'id':'pool-'+str(alpha),'ridge':alpha,'weights':w.tolist(),'development':W.metrics(apply(w,dev),dev)})
  winner=min(candidates,key=lambda c:c['development']['logLoss']);ix=np.flatnonzero(W.S==target);train=np.flatnonzero((W.S<target)&(W.ts+7200000<W.cut[ix].min()))
  w=fit(winner['ridge'],train) if winner['ridge'] is not None else ref.copy();Q=apply(w,ix)
  results.append({'season':target,'selected':winner['id'],'weights':w.tolist(),'candidates':candidates,'baseline':W.metrics(W.P[ix],ix),'candidate':W.metrics(Q,ix),'baselineTips':W.tips(W.P[ix],ix),'candidateTips':W.tips(Q,ix)})
  indexes.extend(ix);predictions.extend(Q)
 ix=np.array(indexes);Q=np.array(predictions);diff=-np.log(W.P[ix,W.Y[ix]])+np.log(Q[np.arange(len(ix)),W.Y[ix]])
 weeks={}
 for j,i in enumerate(ix):
  k=datetime.datetime.fromtimestamp(W.rows[i]['ts']/1000,datetime.timezone.utc).isocalendar()[:2];weeks.setdefault(k,[]).append(j)
 blocks=list(weeks.values());rng=np.random.default_rng(20261019);boots=[float(diff[np.concatenate([blocks[k] for k in rng.integers(0,len(blocks),len(blocks))])].mean()) for _ in range(2000)]
 ci=np.quantile(boots,[.025,.975]).tolist();bm=W.metrics(W.P[ix],ix);qm=W.metrics(Q,ix);bt=W.tips(W.P[ix],ix);qt=W.tips(Q,ix)
 promoted=ci[0]>0 and qm['brier']<=bm['brier'] and qt['hitRate']>=bt['hitRate'] and all(r['candidate']['logLoss']<r['baseline']['logLoss'] for r in results)
 report={'version':'winner-multiscale-v1','datasetHash':D['datasetHash'],'options':D['options'],'protocol':json.loads((R/'scripts/winner-multiscale-protocol.json').read_text()),'folds':results,'pooled':{'baseline':bm,'candidate':qm,'baselineTips':bt,'candidateTips':qt,'logLossImprovement':float(diff.mean()),'weekBootstrap95':ci,'weeks':len(blocks)},'promoted':promoted}
 (R/'src/winner-multiscale-research.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({'folds':[{k:r[k] for k in ['season','selected','weights','baseline','candidate','baselineTips','candidateTips']} for r in results],'pooled':report['pooled'],'promoted':promoted},indent=2))
if __name__=='__main__':run()
