import json,math,itertools,datetime,collections,time
from pathlib import Path
ROOT=Path(__file__).parent
L=json.loads((ROOT/'legs.json').read_text());POOL=json.loads((ROOT/'pool.json').read_text());SOURCES=json.loads((ROOT/'model-sources.json').read_text())
sets={'all':None,'real':lambda c:'+O15' not in c,'side':lambda c:c in ['1','2','1X','X2'],'dc':lambda c:c in ['1X','X2'],'win':lambda c:c in ['1','2'],'goals':lambda c:c[0] in ['O','U'],'btts':lambda c:c in ['BY','BN'],'combo':lambda c:'+O15' in c}
profiles=[(2,4),(3,7),(5,12),(8,12)];bands=[(2,4),(4,8),(8,15)];ranknames=['probability','edge','efficiency'];cutoffs=[.5,.65,.8];minodds=[1.05,1.2];samples=[0,12];spans=[1,2,3]
protocol={'sources':SOURCES,'markets':sorted({l['market'] for l in L}),'market_sets':list(sets),'probability_cutoffs':cutoffs,'minimum_individual_odds':minodds,'sample_minimum':samples,'horizons':spans,'selection_counts':profiles,'odds_bands':bands,'ranking':ranknames,'training':'last game <=2026-10-29','evaluation':'start >=2026-10-30; last game <=2026-11-04','caveat':'Both periods were inspected in earlier conversations. This is exploratory chronological separation, not fresh independent validation. Many equivalent policies and multiple comparisons.','training_selection':'At least3 training tickets; maximize Laplace-smoothed hit rate (wins+1)/(n+2), ties more training tickets then lower predefined policy id. Select separately per odds band, never by evaluation outcome.','hindsight_selection':'Separate diagnostic only: best full-period hit rate among rules with >=8 tickets; not a prospective result.','builder':'Greedy: best permitted market per fixture by ranking, then sorted prefixes up to12; highest estimated joint probability across admissible prefixes and single bookmakers. Not exhaustive combination enumeration.','real_prices':'Win,DC,totals,BTTS observed pre-decision. Four combos synthetic. All known at08:00 Lisbon first day; quotes<6h. One selection per fixture. Teams may repeat on different fixtures after relaxing former limits.','production_changes':False}
(ROOT/'protocol.json').write_text(json.dumps(protocol,ensure_ascii=False,indent=2))
allowed={name:set(i for i,l in enumerate(L) if pred is None or pred(l['market'])) for name,pred in sets.items()}
# Precompute per-source scores and fields used by the rules, never outcomes.
logodd=[math.log(l['odd']) for l in L]
sourceP=[[l['ps'][s] for l in L] for s in range(len(SOURCES))]
scores={}
for s in range(len(SOURCES)):
 p=sourceP[s];scores[(s,'probability')]=p;scores[(s,'edge')]=[p[i]*l['odd'] for i,l in enumerate(L)];scores[(s,'efficiency')]=[math.log(max(p[i],1e-15))/logodd[i] for i in range(len(L))]
leaders={};hindsight={};count=0;fout=(ROOT/'all-policies.jsonl').open('w');starttime=time.time()

def aggregate(tickets):
 n=len(tickets);w=sum(t['hit'] for t in tickets)
 return {'n':n,'wins':w,'rate':w/n if n else None,'mean_odd':sum(t['odd'] for t in tickets)/n if n else None,'mean_legs':sum(len(t['legs']) for t in tickets)/n if n else None,'estimated_price_tickets':sum(t['estimated'] for t in tickets),'profit_units':sum(t['odd'] if t['hit'] else 0 for t in tickets)-n}

for src in range(len(SOURCES)):
 P=sourceP[src]
 for span,mset,pmin,omin,smin,ranking in itertools.product(spans,sets,cutoffs,minodds,samples,ranknames):
  permitted=allowed[mset];score=scores[(src,ranking)];perpolicy=[[[] for b in bands] for p in profiles]
  for day,books in sorted(POOL.items()):
   last=(datetime.date.fromisoformat(day)+datetime.timedelta(days=span-1)).isoformat()
   if last>'2026-11-04':continue
   best=[[None for b in bands] for p in profiles]
   for book,groups in books.items():
    selected=[]
    for g in groups:
     if L[g[0]]['day']>last:continue
     options=[i for i in g if i in permitted and P[i]>=pmin and L[i]['odd']>=omin and (L[i]['old_sample'] if SOURCES[src].startswith('lux') else L[i]['sample'])>=smin]
     if not options:continue
     i=max(options,key=lambda i:(score[i],P[i],-i));selected.append(i)
    selected.sort(key=lambda i:(-score[i],-P[i],i))
    lp=0.;lo=0.;prefix=[]
    for n,i in enumerate(selected[:12],1):
     lp+=math.log(max(P[i],1e-15));lo+=logodd[i];prefix.append(i)
     if lo>math.log(15)+1e-12:break
     if n<2:continue
     odd=math.exp(lo);band=0 if 2<=odd<4 else 1 if 4<=odd<8 else 2 if 8<=odd<=15+1e-10 else None
     if band is None:continue
     for pi,(mn,mx) in enumerate(profiles):
      if not mn<=n<=mx:continue
      prev=best[pi][band]
      if prev is None or lp>prev[0]:best[pi][band]=(lp,odd,tuple(prefix),book)
   for pi in range(len(profiles)):
    for bi in range(len(bands)):
     b=best[pi][bi]
     if b is None:continue
     lp,odd,ids,book=b
     perpolicy[pi][bi].append({'start':day,'last':last,'book':book,'odd':odd,'p':math.exp(lp),'legs':list(ids),'hit':int(all(L[i]['hit'] for i in ids)),'estimated':any(L[i]['estimated'] for i in ids)})
  for pi,(mn,mx) in enumerate(profiles):
   for bi,band in enumerate(bands):
    ts=perpolicy[pi][bi];train=[t for t in ts if t['last']<='2026-10-29'];test=[t for t in ts if t['start']>='2026-10-30']
    params={'source':SOURCES[src],'span':span,'markets':mset,'p_min':pmin,'odd_min':omin,'sample_min':smin,'rank':ranking,'n_min':mn,'n_max':mx,'odd_band':band}
    record={'id':count,'rule':params,'train':aggregate(train),'evaluation':aggregate(test),'all':aggregate(ts)}
    fout.write(json.dumps(record,ensure_ascii=False,separators=(',',':'))+'\n')
    if len(train)>=3:
     key=((record['train']['wins']+1)/(len(train)+2),len(train),-count)
     if bi not in leaders or key>leaders[bi][0]:leaders[bi]=(key,dict(record,tickets=ts))
    if len(ts)>=8:
     key=(record['all']['wins']/len(ts),len(ts),-count)
     if bi not in hindsight or key>hindsight[bi][0]:hindsight[bi]=(key,dict(record,tickets=ts))
    count+=1
  if count%12000==0:print(json.dumps({'policies':count,'seconds':round(time.time()-starttime,1)}),flush=True)
 print(json.dumps({'source_done':SOURCES[src],'policies':count,'seconds':round(time.time()-starttime,1)}),flush=True)
fout.close()
out={'policies':count,'protocol':protocol,'training_selected':{str(k):v[1] for k,v in leaders.items()},'hindsight_only':{str(k):v[1] for k,v in hindsight.items()},'elapsed_seconds':time.time()-starttime}
(ROOT/'results.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
print(json.dumps({'finished':count,'training_selected':{k:{'rule':v[1]['rule'],'train':v[1]['train'],'evaluation':v[1]['evaluation'],'all':v[1]['all']} for k,v in leaders.items()},'hindsight':{k:v[1]['all'] for k,v in hindsight.items()}}),flush=True)
