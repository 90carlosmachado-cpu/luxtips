import json,math,collections,datetime,sys
from pathlib import Path
from zoneinfo import ZoneInfo
def calibrate(cells,rows,over):
    a=[list(x) for x in cells]
    for _ in range(250):
        for i in range(3):
            s=sum(a[i]);a[i]=[v*rows[i]/s for v in a[i]]
        for j,target in enumerate([over,1-over]):
            s=sum(a[i][j] for i in range(3))
            for i in range(3):a[i][j]*=target/s
        if max(abs(sum(a[i])-rows[i]) for i in range(3))<1e-10:break
    assert max(abs(sum(a[i])-rows[i]) for i in range(3))<1e-7
    return a

ROOT=Path(__file__).parent;TZ=ZoneInfo('Europe/Lisbon')
F=json.loads((ROOT/'snapshots.json').read_text());Q=json.loads((ROOT/'quotes.json').read_text())
qmap=collections.defaultdict(dict)
for day,fid,kick,book,market,sel,odd,at,obs in Q:
 qmap[(day,fid,kick,book)][(market,sel)]=(odd,at,obs)
pool=collections.defaultdict(lambda:collections.defaultdict(list));coverage=collections.Counter()
for f in F:
 if not(f['valid']==1 and f['sample']>=12 and f['cutoff']<=f['created_at']<=f['decision']<f['kickoff'] and f['source_at']<=f['created_at']):continue
 parts=json.loads(f['components']) if f['components'] else [{'weight':1,'homeGoals':f['mh'],'awayGoals':f['ma']}]
 p00=sum(c['weight']*math.exp(-c['homeGoals']-c['awayGoals']) for c in parts)
 p10=sum(c['weight']*c['homeGoals']*math.exp(-c['homeGoals']-c['awayGoals']) for c in parts)
 p01=sum(c['weight']*c['awayGoals']*math.exp(-c['homeGoals']-c['awayGoals']) for c in parts)
 p=json.loads(f['probs']);cells=[[p['H']-p10,p10],[p['D']-p00,p00],[p['A']-p01,p01]]
 assert min(v for row in cells for v in row)>0
 assert abs(sum(row[0] for row in cells)-p['O15'])<1e-6
 coverage['valid_game_windows']+=1
 for (day,fid,kickoff,book),quotes in qmap.items():
  if (day,fid,kickoff)!=(f['day'],f['id'],f['kickoff']):continue
  trio=[quotes.get(('Match Winner',s)) for s in ['Home','Draw','Away']]
  if not all(trio) or len({q[1] for q in trio})!=1:continue
  inv=[1/q[0] for q in trio];market=[v/sum(inv) for v in inv]
  totals=[quotes.get(('Goals Over/Under',s)) for s in ['Over 1.5','Under 1.5']]
  joint=None
  if all(totals) and len({q[1] for q in totals})==1:
   over=(1/totals[0][0])/sum(1/q[0] for q in totals);joint=calibrate(cells,market,over)
  choices=[]
  for code,indices,quote in [('1',[0],trio[0]),('2',[2],trio[2]),('1X',[0,1],quotes.get(('Double Chance','Home/Draw'))),('X2',[1,2],quotes.get(('Double Chance','Draw/Away')))]:
   if not quote:continue
   for combo in [False,True]:
    if combo and joint is None:continue
    marginal=sum(market[i] for i in indices)
    pm=sum(cells[i][0] for i in indices) if combo else sum(p[['H','D','A'][i]] for i in indices)
    pq=sum(joint[i][0] for i in indices) if combo else marginal
    probability=(pm+pq)/2;odd=quote[0]*marginal/pq if combo else quote[0]
    outcome=0 if f['hg']>f['ag'] else 2 if f['hg']<f['ag'] else 1
    hit=outcome in indices and (not combo or f['hg']+f['ag']>=2)
    choices.append(dict(id=fid,home=f['home'],away=f['away'],homeId=f['homeId'],awayId=f['awayId'],kickoff=kickoff,day=datetime.datetime.fromtimestamp(kickoff/1000,TZ).date().isoformat(),market=code+('+O1.5' if combo else ''),p=probability,odd=odd,estimated=combo,hit=hit,score=f"{f['hg']}-{f['ag']}",book=book,decision=f['decision'],forecastAt=f['created_at'],quoteAt=quote[1],observedAt=quote[2]))
  if choices:pool[day][book].append(choices)

def optimize(groups,combos,haircut,maxlegs=12,minlegs=5,odd_min=8,odd_max=15):
 low,high=math.log(odd_min),math.log(odd_max);dp=[{} for _ in range(maxlegs+1)];dp[0][0]=[(0.,0.,(),frozenset())]
 for options in groups:
  opts=[]
  for leg in options:
   if leg['estimated'] and not combos:continue
   odd=leg['odd']*(haircut if leg['estimated'] else 1)
   if leg['p']<.5 or odd<1.2:continue
   opts.append((math.log(leg['p']),math.log(odd),dict(leg,odd=odd)))
  if not opts:continue
  teams=frozenset([options[0]['homeId'],options[0]['awayId']])
  for k in range(maxlegs,0,-1):
   for states in list(dp[k-1].values()):
    for logp,logo,legs,usedteams in states:
     if usedteams&teams:continue
     for lp,lo,leg in opts:
      o=logo+lo
      if o>high:continue
      state=(logp+lp,o,legs+(leg,),usedteams|teams);bucket=int(o/.01);dest=dp[k].setdefault(bucket,[])
      if len(dest)<2 or state[0]>dest[-1][0]:
       dest.append(state);dest.sort(key=lambda x:x[0],reverse=True);del dest[2:]
 eligible=[s for k in range(minlegs,maxlegs+1) for values in dp[k].values() for s in values if low<=s[1]<=high]
 if not eligible:return None
 lp,lo,legs,_=max(eligible,key=lambda x:x[0])
 return dict(probability=math.exp(lp),odd=math.exp(lo),legs=legs)

def scenario(span,combos,haircut,maxlegs=12,minlegs=5,odd_min=8,odd_max=15):
 tickets=[];absent=[]
 for day,books in sorted(pool.items()):
  date=datetime.date.fromisoformat(day);end=(date+datetime.timedelta(days=span)).isoformat()
  if end>'2026-11-05':continue # Include only complete settled windows.
  alternatives=[]
  for book,groups in books.items():
   subset=[g for g in groups if g[0]['day']<end]
   t=optimize(subset,combos,haircut,maxlegs,minlegs,odd_min,odd_max)
   if t:alternatives.append(dict(t,start=day,end_exclusive=end,book=book))
  if not alternatives:absent.append(day);continue
  t=max(alternatives,key=lambda x:x['probability']);t['hit']=all(l['hit'] for l in t['legs']);tickets.append(t)
 n=len(tickets);wins=sum(t['hit'] for t in tickets)
 return dict(span=span,combos=combos,haircut=haircut,minlegs=minlegs,maxlegs=maxlegs,odd_min=odd_min,odd_max=odd_max,tickets=tickets,no_ticket_windows=absent,played=n,wins=wins,average_odd=sum(t['odd'] for t in tickets)/n if n else None,average_legs=sum(len(t['legs']) for t in tickets)/n if n else None,actual_multiday_tickets=sum(len({l['day'] for l in t['legs']})>1 for t in tickets),average_estimated_probability=sum(t['probability'] for t in tickets)/n if n else None,nonoverlap_first_anchor={'played':sum((datetime.date.fromisoformat(t['start'])-datetime.date(2026,10,24)).days%span==0 for t in tickets),'wins':sum(t['hit'] and (datetime.date.fromisoformat(t['start'])-datetime.date(2026,10,24)).days%span==0 for t in tickets)})
if __name__=='__main__':
 out=[]
 bands=[(8,15),(8,math.nextafter(10,-math.inf)),(10,math.nextafter(12,-math.inf)),(12,15)]
 for span in [2,3]:
  for lo,hi in bands:
   s=scenario(span,True,1,12,5,lo,hi);s['variant']='nominal';out.append(s)
   print(json.dumps({k:v for k,v in s.items() if k!='tickets'}),flush=True)
  for discount in [.9,.8]:
   s=scenario(span,True,discount);s['variant']='combo_price_sensitivity';out.append(s)
   print(json.dumps({k:v for k,v in s.items() if k!='tickets'}),flush=True)
 for s in out:
  n=s['played'];s['hit_rate']=s['wins']/n if n else None
  s['profit_units']=sum(t['odd'] if t['hit'] else 0 for t in s['tickets'])-n
  s['roi']=s['profit_units']/n if n else None
  s['leg_count_distribution']=dict(collections.Counter(len(t['legs']) for t in s['tickets']))
 result={'scenarios':out,'coverage':dict(coverage),'definition':'08:00 Europe/Lisbon of first day; 2/3-day windows; archived model/quotes available then; eight markets, combo odds estimated; one bookmaker; one selection per fixture; no repeated team; model sample >=12; individual p>=.5, odd>=1.2; 5–12 selections; target odds8–15; approximate DP log-odd buckets .01, two states each; probability product assumes independence. Overlapping windows and reused historical period are not independent validation.'}
 (ROOT/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
