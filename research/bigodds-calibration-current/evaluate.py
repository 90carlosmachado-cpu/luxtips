import json,datetime
from pathlib import Path
import numpy as np
from scipy.optimize import minimize_scalar
ROOT=Path(__file__).parent
protocol={'training':'2024-01-01 through 2025-12-31','evaluation':'2026 games available through frozen input snapshot','model':'Exact current xG90 prior2 at causal decision clocks, market mixing excluded from model calibration','method':'Single multiclass power temperature alpha in [0.5,2], optimized on training log loss. No per-league coefficients or model search.','promotion':'Evaluation multiclass log loss and Brier both decrease; weekly block bootstrap95% upper bound of log-loss difference below zero; xG-covered evaluation subgroup must not worsen either metric.','limitations':'2026 outcomes already inspected in earlier unrelated research. Train contains no xG available at its actual observation clocks. This is a temporal holdout, not untouched prospective evidence. No historical bookmaker-calibration claim.'}
(ROOT/'protocol.json').write_text(json.dumps(protocol,indent=2))
rows=json.loads((ROOT/'predictions.json').read_text());p=np.array([r['p']for r in rows]);y=np.array([r['y']for r in rows]);lp=np.log(np.maximum(p,1e-15));train=np.array([r['day']<'2026-01-01'for r in rows]);ev=~train

def calibrated(alpha):
 z=alpha*lp;z-=z.max(axis=1,keepdims=True);v=np.exp(z);return v/v.sum(axis=1,keepdims=True)
def metrics(q,mask):
 v=q[mask];t=y[mask];return {'n':int(mask.sum()),'logLoss':float(-np.log(v[np.arange(len(t)),t]).mean()),'brier':float(((v-np.eye(3)[t])**2).sum(axis=1).mean())}
fit=minimize_scalar(lambda a:metrics(calibrated(a),train)['logLoss'],bounds=(.5,2),method='bounded',options={'xatol':1e-10});alpha=float(fit.x);q=calibrated(alpha)
diff=-np.log(q[np.arange(len(y)),y])+np.log(p[np.arange(len(y)),y]);weeks={}
for i,r in enumerate(rows):
 if not ev[i]:continue
 key=datetime.date.fromisoformat(r['day']).isocalendar()[:2];weeks.setdefault(key,[]).append(i)
groups=[np.array(ids)for ids in weeks.values()];rng=np.random.default_rng(20261106);boot=[]
for _ in range(3000):
 ids=np.concatenate([groups[i]for i in rng.integers(0,len(groups),len(groups))]);boot.append(float(diff[ids].mean()))
ci=np.quantile(boot,[.025,.975]).tolist();xg=np.array([r['xg']for r in rows])&ev
out={'protocol':protocol,'alpha':alpha,'training':{'before':metrics(p,train),'after':metrics(q,train)},'evaluation':{'before':metrics(p,ev),'after':metrics(q,ev),'logLossDifference95WeeklyBootstrap':ci},'xgEvaluation':{'before':metrics(p,xg),'after':metrics(q,xg)}}
a=out['evaluation'];b=out['xgEvaluation'];out['promote']=a['after']['logLoss']<a['before']['logLoss']and a['after']['brier']<a['before']['brier']and ci[1]<0 and b['after']['logLoss']<=b['before']['logLoss']and b['after']['brier']<=b['before']['brier'];(ROOT/'results.json').write_text(json.dumps(out,indent=2));print(json.dumps(out,indent=2))
