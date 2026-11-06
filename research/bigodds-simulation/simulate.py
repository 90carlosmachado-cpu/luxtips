import json,math,collections,datetime,itertools
from pathlib import Path
from zoneinfo import ZoneInfo
ROOT=Path(__file__).parent
TZ=ZoneInfo('Europe/Lisbon')
F=json.loads((ROOT/'fixtures.json').read_text())
C={x['id']:x for x in json.loads((ROOT/'components.json').read_text())}
Q=json.loads((ROOT/'quotes.json').read_text())+json.loads((ROOT/'goals-quotes.json').read_text())

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

def model_cells(f):
    c=C[f['id']];parts=json.loads(c['components']) if c['components'] else [{'weight':1,'homeGoals':c['hg'],'awayGoals':c['ag']}]
    p00=sum(x['weight']*math.exp(-x['homeGoals']-x['awayGoals']) for x in parts)
    p10=sum(x['weight']*x['homeGoals']*math.exp(-x['homeGoals']-x['awayGoals']) for x in parts)
    p01=sum(x['weight']*x['awayGoals']*math.exp(-x['homeGoals']-x['awayGoals']) for x in parts)
    p=f['probabilities'];cells=[[p['H']-p10,p10],[p['D']-p00,p00],[p['A']-p01,p01]]
    assert all(v>0 for row in cells for v in row)
    assert abs(sum(v for row in cells for v in row)-1)<1e-8
    assert abs(sum(row[0] for row in cells)-p['O15'])<1e-6
    return cells

qmap=collections.defaultdict(dict)
for fid,kick,book,market,sel,odd,at,obs in Q:
    qmap[(fid,kick,book)][(market,sel)]=(odd,at,obs)

pool=collections.defaultdict(lambda:collections.defaultdict(list))
coverage=collections.Counter()
for f in F:
    kick=datetime.datetime.fromtimestamp(f['kickoff']/1000,TZ);day=kick.date().isoformat();decision=datetime.datetime.combine(kick.date(),datetime.time(8),TZ).timestamp()*1000
    if not(f['valid']==1 and f['sample']>=12 and f['cutoff']<=f['created_at']<=decision<f['kickoff'] and f['source_at']<=f['created_at']):continue
    cells=model_cells(f)
    coverage['model_games']+=1
    for (fid,kickoff,book),quotes in qmap.items():
        if fid!=f['id'] or kickoff!=f['kickoff']:continue
        trio=[quotes.get(('Match Winner',s)) for s in ['Home','Draw','Away']]
        if not all(trio) or len({q[1] for q in trio})!=1:continue
        inv=[1/q[0] for q in trio];margin=sum(inv);market=[v/margin for v in inv]
        totals=[quotes.get(('Goals Over/Under',s)) for s in ['Over 1.5','Under 1.5']]
        joint=None
        if all(totals) and len({q[1] for q in totals})==1:
            over=(1/totals[0][0])/sum(1/q[0] for q in totals)
            joint=calibrate(cells,market,over)
            coverage['game_book_with_combo_inputs']+=1
        choices=[]
        for code,indices,quote in [('1',[0],trio[0]),('2',[2],trio[2]),('1X',[0,1],quotes.get(('Double Chance','Home/Draw'))),('X2',[1,2],quotes.get(('Double Chance','Draw/Away')))]:
            if not quote:continue
            base=sum(f['probabilities'][['H','D','A'][i]] for i in indices)
            marginal=sum(market[i] for i in indices)
            for combo in [False,True]:
                if combo and joint is None:continue
                pm=sum(cells[i][0] for i in indices) if combo else base
                pq=sum(joint[i][0] for i in indices) if combo else marginal
                probability=(pm+pq)/2
                odd=quote[0]*marginal/pq if combo else quote[0]
                outcome=0 if f['hg']>f['ag'] else 2 if f['hg']<f['ag'] else 1
                hit=outcome in indices and (not combo or f['hg']+f['ag']>=2)
                choices.append(dict(id=fid,home=f['home'],away=f['away'],market=code+('+O1.5' if combo else ''),p=probability,model=pm,market_p=pq,odd=odd,estimated=combo,hit=hit,score=f"{f['hg']}-{f['ag']}",book=book))
        if choices:pool[day][book].append(choices)

def optimize(groups,n,combos=True,haircut=1,minp=.50):
    # Approximate dynamic program: keep up to two best probabilities per log-odd
    # bucket (width .01), count and fixture prefix. No outcome enters selection.
    low,high=math.log(10),math.log(12);dp=[{} for _ in range(n+1)];dp[0][0]=[(0.,0.,())]
    for options in groups:
        opts=[]
        for leg in options:
            if leg['estimated'] and not combos:continue
            odd=leg['odd']*(haircut if leg['estimated'] else 1)
            if leg['p']<minp or odd<1.2:continue
            opts.append((math.log(leg['p']),math.log(odd),dict(leg,odd=odd)))
        if not opts:continue
        # Descending count prevents using two markets from the same fixture.
        for k in range(n,0,-1):
            for states in list(dp[k-1].values()):
                for logp,logo,legs in states:
                    for lp,lo,leg in opts:
                        o=logo+lo
                        if o>high:continue
                        state=(logp+lp,o,legs+(leg,));bucket=int(o/.01)
                        dest=dp[k].setdefault(bucket,[])
                        if len(dest)<2 or state[0]>dest[-1][0]:
                            dest.append(state);dest.sort(key=lambda x:x[0],reverse=True);del dest[2:]
    eligible=[s for values in dp[n].values() for s in values if low<=s[1]<=high]
    if not eligible:return None
    lp,lo,legs=max(eligible,key=lambda x:x[0])
    return dict(probability=math.exp(lp),odd=math.exp(lo),legs=legs)

def scenario(name,combos,haircut,n,minp=.50):
    tickets=[];missed=[]
    for day,books in sorted(pool.items()):
        alternatives=[]
        for book,groups in books.items():
            ticket=optimize(groups,n,combos,haircut,minp)
            if ticket:alternatives.append(dict(ticket,day=day,book=book))
        if not alternatives:missed.append(day);continue
        t=max(alternatives,key=lambda x:x['probability']);t['hit']=all(x['hit'] for x in t['legs']);t['estimated_legs']=sum(x['estimated'] for x in t['legs']);tickets.append(t)
    wins=sum(t['hit'] for t in tickets);profit=sum(t['odd'] if t['hit'] else 0 for t in tickets)-len(tickets)
    return dict(name=name,legs=n,price_haircut=haircut,minimum_probability=minp,tickets=tickets,no_ticket_days=missed,played=len(tickets),wins=wins,hit_rate=wins/len(tickets) if tickets else None,average_odd=sum(t['odd'] for t in tickets)/len(tickets) if tickets else None,profit_units=profit,roi=profit/len(tickets) if tickets else None)

if __name__=='__main__':
    out=[]
    for name,combo,haircut in [('4 markets — real odds',False,1),('8 markets — estimated combos',True,1),('8 markets — combos -10%',True,.9),('8 markets — combos -20%',True,.8)]:
        for n in [4,5,6]:
            s=scenario(name,combo,haircut,n);out.append(s)
            print(json.dumps({k:v for k,v in s.items() if k not in ['tickets','no_ticket_days']},ensure_ascii=False),flush=True)
    result={'coverage':dict(coverage),'days':list(sorted(pool)),'input_fixtures':len(F),'scenarios':out,'method':{'decision_time':'08:00 Europe/Lisbon','model':'archived v4, sample >=12','probability':'50% archived model + 50% current-at-cutoff devig market','combo_price':'actual side odd * market(side)/IPF market(side AND over1.5)','search':'approximate DP, log-odd bucket .01, two states per bucket','markets':['1X','X2','1X+O1.5','X2+O1.5','1+O1.5','2+O1.5','1','2'],'target_odds':[10,12],'single_bookmaker_per_ticket':True,'retrospective_exploratory':True}}
    result['adaptive_4_to_6']=[]
    for name in dict.fromkeys(s['name'] for s in out):
        scenarios=[s for s in out if s['name']==name]
        days=sorted({t['day'] for s in scenarios for t in s['tickets']})
        tickets=[max([t for s in scenarios for t in s['tickets'] if t['day']==day],key=lambda t:t['probability']) for day in days]
        result['adaptive_4_to_6'].append(dict(name=name,tickets=tickets,played=len(tickets),wins=sum(t['hit'] for t in tickets),average_odd=sum(t['odd'] for t in tickets)/len(tickets) if tickets else None,winning_legs=sum(l['hit'] for t in tickets for l in t['legs']),legs=sum(len(t['legs']) for t in tickets),average_estimated_probability=sum(t['probability'] for t in tickets)/len(tickets) if tickets else None))
    (ROOT/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
