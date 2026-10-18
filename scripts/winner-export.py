"""Export the already selected 2026 coefficients and retrospective diagnostics; no tuning."""
import json,pathlib
import numpy as np
from importlib.machinery import SourceFileLoader
R=pathlib.Path(__file__).resolve().parents[1]
M=SourceFileLoader('winner_multiscale',str(R/'scripts/winner-multiscale.py')).load_module();W=M.W
report=json.loads((R/'src/winner-multiscale-research.json').read_text());assert report['promoted']
components=[{**o,'weight':w} for o,w in zip(report['options'],report['folds'][-1]['weights']) if w>1e-8]
total=sum(c['weight'] for c in components)
for c in components:c['weight']/=total
config={'version':'winner-multiscale-v1','status':'retrospective-evidence-awaiting-prospective-confirmation','components':components,'trainedBefore':int(W.cut[W.S==2026].min()),'datasetHash':report['datasetHash']}
(R/'src/winner-config.json').write_text(json.dumps(config,indent=2)+'\n')
ix=np.concatenate([np.flatnonzero(W.S==f['season']) for f in report['folds']]);Q=np.concatenate([M.apply(f['weights'],np.flatnonzero(W.S==f['season'])) for f in report['folds']])
def bins(p,y):
 result=[]
 for i in range(10):
  mask=(p>=i/10)&(p<(i+1)/10);n=int(mask.sum());w=int(y[mask].sum());rate=w/n if n else 0
  z=1.959963984540054;d=1+z*z/n if n else 1;c=(rate+z*z/(2*n))/d if n else .5;m=z*np.sqrt(rate*(1-rate)/n+z*z/(4*n*n))/d if n else .5
  result.append({'low':i/10,'high':(i+1)/10,'n':n,'rate':rate,'mean':float(p[mask].mean()) if n else 0,'interval':[c-m,c+m]})
 return result
markets={}
for k,c in [('H',0),('A',2)]:
 p=Q[:,c];y=(W.Y[ix]==c).astype(int)
 markets[k]={'enabled':True,'bins':bins(p,y),'byLeague':{str(l):{'enabled':bool(np.sum([W.rows[i]['league']==l for i in ix])>=100)} for l in sorted(set(r['league'] for r in W.rows))}}
report['calibration']={'markets':markets}
report['byLeague']={}
for league in sorted(set(r['league'] for r in W.rows)):
 mask=np.array([W.rows[i]['league']==league for i in ix]);report['byLeague'][str(league)]={'baseline':W.metrics(W.P[ix][mask],ix[mask]),'candidate':W.metrics(Q[mask],ix[mask])}
report['configuration']=config
report['limitations']=['Retrospective nested evaluation; seasons already inspected in earlier model research.','Hit-rate difference is small; selected match sets and counts differ.','No historical odds; profitability not demonstrated.','Daily historical cutoff differs from intraday live refresh; source delays not simulated.','Prospective forecasts must remain immutable.']
(R/'src/winner-multiscale-research.json').write_text(json.dumps(report,indent=2)+'\n')
# Golden case validates JS mixture probabilities against the Python experiment.
i=int(np.flatnonzero(W.S==2026)[0]);w=report['folds'][-1]['weights']
(R/'tests/winner-golden.json').write_text(json.dumps({'base':M.B[i].tolist(),'weights':w,'probabilities':M.apply(w,[i])[0].tolist()},indent=2)+'\n')
print(json.dumps(config))
