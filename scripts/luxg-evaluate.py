"""Open the locked 2026 holdout once; no candidate fitting or selection."""
import json, pathlib, datetime
from importlib.machinery import SourceFileLoader
import numpy as np
R=pathlib.Path(__file__).resolve().parents[1]
t=SourceFileLoader('luxg_train',str(R/'scripts/luxg-train.py')).load_module()
lock=json.loads((R/'data/luxg-candidate-lock.json').read_text())
assert lock['selected'] is None, 'Review a selected candidate against the full promotion protocol'
rows=[r for r in t.D['rows'] if r['season']==2026 and r['sample']>=12]
X,b,y=t.matrices(rows);p=lock['bestExperimental']['params'];mu=t.means(p,X,b)
baseline=t.metric(b,y);experimental=t.metric(mu,y,p['rho'])
diff=t.losses(b,y)[0]-t.losses(mu,y,p['rho'])[0]
weeks={}
for i,r in enumerate(rows):
 k=datetime.datetime.fromtimestamp(r['ts']/1000,datetime.timezone.utc).isocalendar()[:2]
 weeks.setdefault(k,[]).append(i)
blocks=list(weeks.values());rng=np.random.default_rng(20261018)
samples=[float(diff[np.concatenate([blocks[i] for i in rng.integers(0,len(blocks),len(blocks))])].mean()) for _ in range(2000)]
report={'version':'luxg-1','activeModel':'opponent-adjusted Poisson','promoted':False,'reason':'No candidate passed the development gate; holdout is reported without changing that decision.','datasetHash':lock['datasetHash'],'protocol':lock['protocol'],'trainMatches':lock['trainMatches'],'developmentMatches':lock['developmentMatches'],'candidateCount':45,'baselineDevelopment':lock['baselineDevelopment'],'holdout':{'season':2026,'baseline':baseline,'experimental':experimental,'experimentalId':lock['bestExperimental']['id'],'scoreLogLossImprovement':float(diff.mean()),'weekBootstrap95':np.quantile(samples,[.025,.975]).tolist(),'weeks':len(blocks)},'byLeague':{str(l):{'baseline':t.metric(b[[r['league']==l for r in rows]],y[[r['league']==l for r in rows]]),'experimental':t.metric(mu[[r['league']==l for r in rows]],y[[r['league']==l for r in rows]],p['rho'])} for l in sorted(set(r['league'] for r in rows))},'limitations':['Goal estimates from match results, not shot-based event xG.','No historical odds: no ROI or betting advantage established.','2026 season is incomplete; limited holdout size.','Training and development experiments are retained; multiple testing limits evidence.','Rolling team states only use matches available before each prediction cutoff.']}
(R/'src/luxg-validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report['holdout'],indent=2))
