import json,math,datetime
from pathlib import Path
from ticket_guard import gate
ROOT=Path(__file__).parent
HISTORY=ROOT/"ticket-history.json"
if not HISTORY.exists():
 raise RuntimeError("Previous ticket history required before generating another ticket")
history=json.loads(HISTORY.read_text())
guard=gate(history,1793865600000)
if not guard["can_generate"]:
 print(json.dumps({"status":"blocked_active_ticket",**guard}));raise SystemExit(0)
excluded=set(guard["excluded_fixture_ids"])
C=json.loads((ROOT/'candidate.json').read_text());L=json.loads((ROOT/'legs.json').read_text());POOL=json.loads((ROOT/'pool.json').read_text());sources=json.loads((ROOT/'model-sources.json').read_text());src=sources.index(C['rule']['source']);rule=C['rule']
assert rule=={'source':'goals4','span':2,'markets':'all','p_min':.5,'odd_min':1.2,'sample_min':0,'rank':'probability','n_min':5,'n_max':12,'odd_band':[8,15]}
P=[l['ps'][src] for l in L];options=[]
for start,books in POOL.items():
 for book,groups in books.items():
  selected=[]
  for g in groups:
   eligible=[i for i in g if L[i]['id'] not in excluded and P[i]>=rule['p_min'] and L[i]['odd']>=rule['odd_min'] and L[i]['sample']>=rule['sample_min']]
   if eligible:selected.append(max(eligible,key=lambda i:(P[i],P[i],-i)))
  selected.sort(key=lambda i:(-P[i],-P[i],i))
  lp=lo=0.;prefix=[]
  for n,i in enumerate(selected[:12],1):
   lp+=math.log(P[i]);lo+=math.log(L[i]['odd']);prefix.append(i)
   if lo>math.log(15)+1e-12:break
   odd=math.exp(lo)
   if 5<=n<=12 and 8<=odd<=15+1e-10:options.append({'start':start,'book':book,'odd':odd,'joint_model_probability':math.exp(lp),'legs':prefix.copy(),'estimated_combo_count':sum(L[j]['estimated'] for j in prefix),'outcome':None})
chosen=max(options,key=lambda x:x['joint_model_probability']) if options else None
out={'candidate_id':C['id'],'cutoff_utc':'2026-11-05T08:00:00Z','target_days':['2026-11-05','2026-11-06'],'generated_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'mode':'offline retrospective morning reconstruction; not a new17h betting recommendation','used_current_results':False,'source_fixtures':len(json.loads((ROOT/'snapshots.json').read_text())),'eligible_leg_quotes':len(L),'feasible_tickets':len(options),'ticket':chosen,'other_feasible_tickets':options,'settlement':None,'production_changes':False}
(ROOT/'cycle.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
print(json.dumps({k:v for k,v in out.items() if k not in ['other_feasible_tickets']},ensure_ascii=False))
if chosen:
 for i in chosen['legs']:
  l=L[i];print(datetime.datetime.fromtimestamp(l['kickoff']/1000,datetime.timezone.utc).isoformat(),l['home'],'-',l['away'],l['market'],round(l['odd'],3),'estimated',l['estimated'],'p',round(P[i],4))
