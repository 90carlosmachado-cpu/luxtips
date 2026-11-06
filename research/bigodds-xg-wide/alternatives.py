import csv,json,math
from pathlib import Path
import search as s
import audit
ROOT=Path(__file__).parent

def record(row):
 mi=int(row['model']);base=(row['markets'],float(row['pmin']),float(row['oddmin']),int(row['samplemin']),row['ranking'],row['xg_mode'],row['direction']);span=int(row['span']);profile=(int(row['nmin']),int(row['nmax']));ts=s.tickets_for(mi,base,span,profile,s.prepare(mi));full,train,evaluation=s.categories(ts)
 return dict(id=int(row['id']),rule=s.rule_dict(mi,base,span,profile),all=full,train=train,evaluation=evaluation,tickets=ts)

def run():
 best={};counts=0;train_no_under=[]
 with (ROOT/'all-policies.csv').open() as f:
  for row in csv.DictReader(f):
   counts+=1;model=s.MODELS[int(row['model'])];n=int(row['n']);legs=int(row['legs']);xg=int(row['xg_legs'])
   if model['xg_weight']>0 and row['markets']=='no_unders' and row['direction']=='fixed' and int(row['train_n'])>=3:
    train_no_under.append((((int(row['train_wins'])+1)/(int(row['train_n'])+2),int(row['train_n']),-int(row['id'])),row))
   if model['xg_weight']<=0 or n<8 or not legs or xg/legs<.5:continue
   key=(int(row['wins'])/n,n,-int(row['id']))
   for category,allowed in [('fixed_direction',row['direction']=='fixed'),('no_unders',row['markets']=='no_unders'),('fixed_no_unders',row['direction']=='fixed' and row['markets']=='no_unders')]:
    if allowed and (category not in best or key>best[category][0]):best[category]=(key,row)
 out={'policies_read':counts,'alternatives':{k:record(v[1]) for k,v in best.items()}}
 for key,row in sorted(train_no_under,key=lambda x:x[0],reverse=True):
  candidate=record(row)
  if candidate['train']['xg_share']>=.5:
   out['alternatives']['no_unders_train_selected']=candidate;break
 for v in out['alternatives'].values():
  v['sequential']=audit.sequential(v);v['matched_no_xg']=audit.counterfactual(v)
 (ROOT/'alternatives.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
 print(json.dumps({k:{'rule':v['rule'],'all':v['all'],'sequential':v['sequential']['all']} for k,v in out['alternatives'].items()},ensure_ascii=False,indent=2))
if __name__=='__main__':run()
