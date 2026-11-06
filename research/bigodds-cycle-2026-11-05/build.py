import json,math,collections,datetime
from pathlib import Path
import base as b
ROOT=Path(__file__).parent
S=json.loads((ROOT/'snapshots.json').read_text());Q=json.loads((ROOT/'quotes.json').read_text())
for f in S:b.FD[f['id']]=[f['id'],f['league'],f['kickoff'],f['homeId'],f['awayId'],None,None,f['season'],f['home'],f['away'],False]
M={'1':0,'2':2,'1X':3,'X2':4,'1+O15':5,'2+O15':6,'1X+O15':7,'X2+O15':8,'O05':9,'U05':10,'O15':11,'U15':12,'O25':13,'U25':14,'O35':15,'U35':16,'O45':17,'U45':18,'BY':19,'BN':20}
sources=['market','lux','lux_mix','goals4','goals4_mix','elo20','elo20_mix','xg25','xg25_mix']
# Reconstruct all candidates, without the former sample>=12 exclusion.
idx=0;F={}
for day,group in __import__('itertools').groupby(sorted(S,key=lambda x:(x['day'],x['id'])),key=lambda x:x['day']):
 group=list(group);cut=group[0]['decision']
 while idx<len(b.F) and b.F[idx][2]+7200000<=cut:
  f=b.F[idx];b.update(f,f[2]+7200000);idx+=1
 for old in group:
  f=b.FD.get(old['id'])
  if not f or f[2]!=old['kickoff']:continue
  ps,sample,sa,xa,maxinput=b.predict(f,cut)
  F[(day,old['id'])]=(ps,sample,maxinput)
qmap=collections.defaultdict(dict)
for day,fid,kick,book,market,sel,odd,at,obs in Q:qmap[(day,fid,kick,book)][(market,sel)]=(odd,at,obs)
# IPF association for synthetic combo prices, identical for all model sources.
def ipf(cells,rows,over):
 a=[list(x) for x in cells]
 for _ in range(250):
  for i in range(3):
   factor=rows[i]/sum(a[i]);a[i]=[v*factor for v in a[i]]
  for j,target in enumerate([over,1-over]):
   factor=target/sum(a[i][j] for i in range(3))
   for i in range(3):a[i][j]*=factor
  if max(abs(sum(a[i])-rows[i]) for i in range(3))<1e-9:break
 return a
pool=collections.defaultdict(lambda:collections.defaultdict(list));legs=[]
for old in S:
 if old['valid']!=1 or not(old['cutoff']<=old['created_at']<=old['decision']<old['kickoff']):continue
 model=F.get((old['day'],old['id']))
 if not model:continue
 ps,sample,maxinput=model;orig=json.loads(old['probs']);parts=json.loads(old['components']) if old['components'] else [{'weight':1,'homeGoals':old['mh'],'awayGoals':old['ma']}]
 p00=sum(c['weight']*math.exp(-c['homeGoals']-c['awayGoals']) for c in parts);p10=sum(c['weight']*c['homeGoals']*math.exp(-c['homeGoals']-c['awayGoals']) for c in parts);p01=sum(c['weight']*c['awayGoals']*math.exp(-c['homeGoals']-c['awayGoals']) for c in parts)
 lux={'1':orig['H'],'2':orig['A'],'1X':orig['H']+orig['D'],'X2':orig['A']+orig['D'],'1+O15':orig['H']-p10,'2+O15':orig['A']-p01,'1X+O15':orig['H']+orig['D']-p10-p00,'X2+O15':orig['A']+orig['D']-p01-p00,'BY':orig['BY'],'BN':1-orig['BY']}
 for k in ['O05','O15','O25','O35','U45']:
  if k in orig:lux[k]=orig[k];lux[('U' if k[0]=='O' else 'O')+k[1:]]=1-orig[k]
 cells=[[orig['H']-p10,p10],[orig['D']-p00,p00],[orig['A']-p01,p01]]
 for (day,fid,kick,book),quotes in qmap.items():
  if (day,fid,kick)!=(old['day'],old['id'],old['kickoff']):continue
  events=[];trio=[quotes.get(('Match Winner',s)) for s in ['Home','Draw','Away']];market=None
  if all(trio) and len({q[1] for q in trio})==1:
   inv=[1/q[0] for q in trio];market=[v/sum(inv) for v in inv]
   for code,indices,q in [('1',[0],trio[0]),('2',[2],trio[2]),('1X',[0,1],quotes.get(('Double Chance','Home/Draw'))),('X2',[1,2],quotes.get(('Double Chance','Draw/Away')))]:
    if q:events.append((code,sum(market[i] for i in indices),q[0],False,q[1],q[2]))
  over15=None
  for total in [.5,1.5,2.5,3.5,4.5]:
   pair=[quotes.get(('Goals Over/Under',side+' '+str(total))) for side in ['Over','Under']]
   if not all(pair) or len({q[1] for q in pair})!=1:continue
   p=(1/pair[0][0])/sum(1/q[0] for q in pair);suffix=str(total).replace('.','')
   for j,side in enumerate(['O','U']):events.append((side+suffix,p if j==0 else 1-p,pair[j][0],False,pair[j][1],pair[j][2]))
   if total==1.5:over15=p
  pair=[quotes.get(('Both Teams Score',s)) for s in ['Yes','No']]
  if all(pair) and len({q[1] for q in pair})==1:
   p=(1/pair[0][0])/sum(1/q[0] for q in pair)
   for j,code in enumerate(['BY','BN']):events.append((code,p if j==0 else 1-p,pair[j][0],False,pair[j][1],pair[j][2]))
  if market and over15 is not None and min(v for c in cells for v in c)>0:
   joint=ipf(cells,market,over15)
   for code,indices,q in [('1',[0],trio[0]),('2',[2],trio[2]),('1X',[0,1],quotes.get(('Double Chance','Home/Draw'))),('X2',[1,2],quotes.get(('Double Chance','Draw/Away')))]:
    if not q:continue
    marginal=sum(market[i] for i in indices);pj=sum(joint[i][0] for i in indices)
    events.append((code+'+O15',pj,q[0]*marginal/pj,True,q[1],q[2]))
  group=[]
  h=a=0;H=A=O=False # No outcomes are loaded or used in this cycle.
  for code,mp,odd,estimated,at,obs in events:
   if code not in lux or code not in M:continue
   values=[mp,lux[code],.5*(lux[code]+mp),ps[2][M[code]],.5*(ps[2][M[code]]+mp),ps[3][M[code]],.5*(ps[3][M[code]]+mp),ps[5][M[code]],.5*(ps[5][M[code]]+mp)]
   if not all(0<=v<=1 for v in values):continue
   hit={'1':H,'2':A,'1X':not A,'X2':not H,'1+O15':H and O,'2+O15':A and O,'1X+O15':not A and O,'X2+O15':not H and O,'BY':h>0 and a>0,'BN':h==0 or a==0}.get(code)
   if hit is None:hit=h+a>float(code[1])/1 if code[0]=='O' else h+a<=float(code[1])/1
   # Code O25 means >2.5, implemented by integer total>2.
   if code[0] in ['O','U']:hit=h+a>int(code[1]) if code[0]=='O' else h+a<=int(code[1])
   leg={'id':fid,'day':datetime.datetime.fromtimestamp(kick/1000,b.TZ).date().isoformat(),'kickoff':kick,'home':old['home'],'away':old['away'],'market':code,'odd':odd,'estimated':estimated,'ps':values,'sample':sample,'old_sample':old['sample'],'hit':None,'score':None,'decision':old['decision'],'quote_at':at,'observed_at':obs,'candidate_max_input':maxinput,'book':book}
   group.append(len(legs));legs.append(leg)
  if group:pool[day][book].append(group)
(ROOT/'legs.json').write_text(json.dumps(legs,separators=(',',':'),ensure_ascii=False))
(ROOT/'pool.json').write_text(json.dumps(pool,separators=(',',':')))
(ROOT/'model-sources.json').write_text(json.dumps(sources))
print(json.dumps({'legs':len(legs),'days':len(pool),'sources':sources,'markets':sorted({l['market'] for l in legs})}),flush=True)
