import sys,json,copy
from pathlib import Path
ROOT=Path(__file__).parent
sys.path.insert(0,str(ROOT.parent/'bigodds-audit'));import engine
F={(f['day'],f['id']):f for f in json.loads((ROOT/'candidate-forecasts.json').read_text())}
M={'1':0,'2':2,'1X':3,'X2':4,'1+O1.5':5,'2+O1.5':6,'1X+O1.5':7,'X2+O1.5':8}
original=copy.deepcopy(engine.pool);out=[]
for name,mi in [('goals4',2),('goals8_elo20',3),('goals8_xg25',5)]:
 engine.pool=copy.deepcopy(original)
 for day,books in engine.pool.items():
  for book,groups in books.items():
   revised=[]
   for g in groups:
    f=F.get((day,g[0]['id']))
    if not f:continue
    for l in g:
     l['candidate_p']=f['ps'][mi][M[l['market']]];l['p']=.5*l['candidate_p']+.5*l['market_p'];l['candidate_max_input']=f['max_input_completion'];l['candidate_decision']=f['decision']
    revised.append(g)
   books[book]=revised
 for combos,haircut in [(False,1),(True,.9)]:
  s=engine.scenario(3,combos,haircut,12,5,8,15);s['model']=name;out.append(s)
  print(json.dumps({k:v for k,v in s.items() if k!='tickets'}),flush=True)
(ROOT/'robustness3.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
