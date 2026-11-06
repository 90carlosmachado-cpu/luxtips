import json
from pathlib import Path
import engine as e
root=Path(__file__).parent
for books in e.pool.values():
 for groups in books.values():
  for g in groups:
   for l in g:l['p']=l['market_p']
r=json.loads((root/'audit.json').read_text());r['robustness']=[]
for combos,haircut in [(False,1),(True,.9),(True,.8)]:
 s=e.scenario(2,combos,haircut,7,5,8,15);s['basis']='market_reference'
 r['robustness'].append(s);print(json.dumps({k:v for k,v in s.items() if k!='tickets'}),flush=True)
(root/'audit.json').write_text(json.dumps(r,ensure_ascii=False,indent=2))
