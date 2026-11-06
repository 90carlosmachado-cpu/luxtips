import sys,json,copy,datetime,collections,math
from pathlib import Path
ROOT=Path(__file__).parent;BASE=ROOT.parent
sys.path.insert(0,str(BASE/'bigodds-history'));import study
sys.path.insert(0,str(BASE/'bigodds-audit'));import engine
S=json.loads((BASE/'bigodds-audit/snapshots.json').read_text())
models=[('goals4',2),('goals8_elo20',3),('goals8_xg25',5)]
M={'1':0,'2':2,'1X':3,'X2':4,'1+O1.5':5,'2+O1.5':6,'1X+O1.5':7,'X2+O1.5':8}
protocol={'scope':'2026/27 archived quote period 24 October–4 November only; not the entire season','models':models,'counts':[[5,12],[5,7],[8,12],[9,9]],'windows':[2,3],'odds':[8,15],'probabilities':'50% reconstructed historical candidate +50% same market reference as earlier replay','combo_prices':'Unchanged estimates from previous engine; not recalculated to favor a candidate. Real quotes for base markets.','historical_availability':'Candidate forecasts are ex-post event-time reconstructions, not original archived predictions. Raw results assumed available kickoff+2h.','selection':'Each policy chooses highest estimated joint probability without using outcomes; no rule chosen because it wins current-period tickets.','development':'Candidate parameters fixed in previous historical study; goals4 was selected on 2024, Elo20 and xG25 are fixed controls.','out_of_sample':'Current period already inspected extensively; this is exploratory and cannot prove independent validation.','production_changes':False}
(ROOT/'protocol.json').write_text(json.dumps(protocol,indent=2))
idx=0;forecast={}
for day,group in __import__('itertools').groupby(sorted(S,key=lambda x:(x['day'],x['id'])),key=lambda x:x['day']):
 group=list(group);cut=group[0]['decision']
 while idx<len(study.F) and study.F[idx][2]+7200000<=cut:
  f=study.F[idx];study.update(f,f[2]+7200000);idx+=1
 for old in group:
  f=study.FD.get(old['id'])
  if not f or f[2]!=old['kickoff']:continue
  p,sample,sa,xa,maxinput=study.predict(f,cut)
  if sample<12:continue
  forecast[(day,old['id'])]={'ps':p,'sample':sample,'xg_active':xa,'max_input_completion':maxinput,'decision':cut}
(ROOT/'candidate-forecasts.json').write_text(json.dumps([{'day':d,'id':fid,**v} for (d,fid),v in forecast.items()],separators=(',',':')))
original=copy.deepcopy(engine.pool);result={'protocol':protocol,'comparisons':[],'robustness':[]}
for name,mi in models:
 engine.pool=copy.deepcopy(original)
 for day,books in engine.pool.items():
  for book,groups in books.items():
   revised=[]
   for group in groups:
    key=(day,group[0]['id']);f=forecast.get(key)
    if not f:continue
    for l in group:
     l['candidate_p']=f['ps'][mi][M[l['market']]]
     l['p']=.5*l['candidate_p']+.5*l['market_p'];l['candidate_max_input']=f['max_input_completion'];l['candidate_decision']=f['decision']
    revised.append(group)
   books[book]=revised
 for span in [2,3]:
  for mn,mx in [[5,12],[5,7],[8,12],[9,9]]:
   s=engine.scenario(span,True,1,mx,mn,8,15);s['model']=name;s['rate']=s['wins']/s['played'] if s['played'] else None
   result['comparisons'].append(s)
   print(json.dumps({k:v for k,v in s.items() if k!='tickets'}),flush=True)
   (ROOT/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
 # Predeclared price robustness for main policy, regardless of observed wins.
 for combos,haircut in [(False,1),(True,.9)]:
  s=engine.scenario(2,combos,haircut,12,5,8,15);s['model']=name
  result['robustness'].append(s)
  print(json.dumps({'robustness':True,**{k:v for k,v in s.items() if k!='tickets'}}),flush=True)
  (ROOT/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
