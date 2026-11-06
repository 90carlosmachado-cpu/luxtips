import json,csv,collections,math,datetime
from pathlib import Path
import numpy as np
import search as s
ROOT=Path(__file__).parent

def unpack(record):
 r=record['rule'];mi=s.MODELS.index(r['model']);base=(r['markets'],r['p_min'],r['odd_min'],r['sample_min'],r['ranking'],r['xg_mode'],r['direction']);return mi,base,r['span'],(r['n_min'],r['n_max'])

def counterfactual(record):
 mi,base,span,profile=unpack(record);model=s.MODELS[mi];control=next(i for i,m in enumerate(s.MODELS) if m['half_life']==model['half_life'] and m['prior']==model['prior'] and m['xg_weight']==0 and m['market_mix']==model['market_mix'])
 P,A,D,scores,orders=s.prepare(control);A=np.r_[s.ALLA[mi],False] # identical xG coverage filter; only its numerical signal is removed
 prepared=(P,A,D,scores,orders);ts=s.tickets_for(control,base,span,profile,prepared)
 coverage=sum(t['xg_legs'] for t in ts)
 for t in ts:t['xg_legs']=0
 return {'purpose':'Matched no-xG signal, keeping the same xG coverage filter and other rules','coverage_qualified_legs':coverage,'all':s.aggregate(ts),'tickets':ts}

def sequential(record):
 mi,base,span,profile=unpack(record);P,A,D,scores,orders=s.prepare(mi);blocked=set();active_until=0;out=[];skipped=[]
 # Rebuild each selected day with every previously published fixture excluded.
 for day in s.DAYS:
  last=(datetime.date.fromisoformat(day)+datetime.timedelta(days=span-1)).isoformat()
  if last>'2026-11-04':continue
  cut=next(l['decision'] for l in s.L if datetime.date.fromtimestamp(l['decision']/1000).isoformat()==day)
  if active_until>=cut:skipped.append({'day':day,'reason':'active_at_08h'});continue
  local_P=P.copy();local_P[[i for i,l in enumerate(s.L) if l['id'] in blocked]]=0
  local_scores={'probability':local_P,'edge':local_P*s.odd,'efficiency':np.divide(np.log(np.maximum(local_P,1e-15)),s.logodd,out=np.full(s.N+1,-np.inf),where=s.logodd>0)}
  local_orders={rank:np.take_along_axis(s.G,np.lexsort((s.G,-local_P[s.G],-score[s.G]),axis=1),axis=1) for rank,score in local_scores.items()}
  ts=s.tickets_for(mi,base,span,profile,(local_P,A,D,local_scores,local_orders));t=next((t for t in ts if t['start']==day),None)
  if not t:skipped.append({'day':day,'reason':'no_eligible_ticket'});continue
  losses=[s.L[i]['kickoff']+7200000 for i in t['legs'] if not s.L[i]['hit']]
  active_until=min(losses) if losses else max(s.L[i]['kickoff']+7200000 for i in t['legs']);t['assumed_closed_at']=active_until;blocked.update(s.L[i]['id'] for i in t['legs']);out.append(t)
 return {'assumption':'Final results assumed available kickoff+2h, not actual archived settlement clocks. Daily08h only; all used fixtures excluded. Diagnostic only, not proof of live settlement behavior.','all':s.aggregate(out),'tickets':out,'skipped':skipped}

def run():
 r=json.loads((ROOT/'results.json').read_text());out={'matched_no_xg':counterfactual(r['leaders']['xg_full']),'sequential_xg_full':sequential(r['leaders']['xg_full']),'sequential_control_full':sequential(r['leaders']['control_full'])}
 for key,record in r['leaders'].items():
  mi,base,span,profile=unpack(record);ts=s.tickets_for(mi,base,span,profile,s.prepare(mi));assert [(t['start'],t['legs']) for t in ts]==[(t['start'],t['legs']) for t in record['tickets']]
  # Pairwise conflicting selections for a repeated fixture across tickets.
  picks=collections.defaultdict(set)
  for t in ts:
   for i in t['legs']:picks[s.L[i]['id']].add(s.L[i]['market'])
  record['repeated_fixture_market_changes']={str(fid):sorted(markets) for fid,markets in picks.items() if len(markets)>1}
 (ROOT/'results.json').write_text(json.dumps(r,ensure_ascii=False,indent=2));(ROOT/'audit.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
 print(json.dumps({k:{'all':v['all'],'skipped':v.get('skipped')} for k,v in out.items()},ensure_ascii=False,indent=2))
 print('xg candidate',json.dumps([(t['start'],t['hit'],round(t['odd'],2),len(t['legs'])) for t in r['leaders']['xg_full']['tickets']]))
if __name__=='__main__':run()
