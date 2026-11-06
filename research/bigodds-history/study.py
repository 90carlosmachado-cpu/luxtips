import json,math,datetime,collections,hashlib
from pathlib import Path
from zoneinfo import ZoneInfo
import numpy as np
ROOT=Path(__file__).parent;TZ=ZoneInfo('Europe/Lisbon');DAY=86400000;DECAY=180*DAY/math.log(2)
MODELS=['league','goals8','goals4','goals8_elo20','goals8_sot25','goals8_xg25']
KEYS=['H','D','A','HX','XA','HO','AO','HXO','XAO']
F=[]
for y in [2023,2024,2025,2026]:F.extend(json.loads((ROOT/f'fixtures-{y}.json').read_text()))
F.sort(key=lambda x:(x[2],x[0]));FD={f[0]:f for f in F}
D={};rejected=0
for d in json.loads((ROOT/'details.json').read_text()):
 f=FD.get(d[0])
 if not f or (d[1],d[3],d[4])!=(f[2],f[5],f[6]):rejected+=1;continue
 # Ex-post reconstruction by event time. Import timestamps are retained in
 # inputs and explicitly NOT represented as historical data availability.
 if d[0] not in D:D[d[0]]=d

class State:
 def __init__(self):self.last=0;self.v=np.zeros(11);self.raw=0
 def at(self,t):
  if self.last:self.v*=math.exp(-(t-self.last)/DECAY)
  self.last=t;return self.v
 def add(self,t,gf,ga,sf=None,sa=None,xf=None,xa=None):
  v=self.at(t);v[0]+=1;v[1]+=gf;v[2]+=ga;self.raw+=1
  if sf is not None and sa is not None:v[3]+=1;v[4]+=sf;v[5]+=sa
  if xf is not None and xa is not None:v[6]+=1;v[7]+=xf;v[8]+=xa

def validpair(a,b,maximum):return a is not None and b is not None and math.isfinite(a) and math.isfinite(b) and 0<=a<=maximum and 0<=b<=maximum
L=collections.defaultdict(State);T=collections.defaultdict(State);E=collections.defaultdict(lambda:1500.)
ELN=collections.Counter();done=[];idx=0

def update(f,t):
 fid,league,ts,home,away,hg,ag,*_=f;d=D.get(fid);hs=as_=hx=ax=None
 if d:
  if validpair(d[7],d[8],50) and validpair(d[5],d[6],100) and d[7]<=d[5] and d[8]<=d[6]:hs,as_=d[7],d[8]
  if validpair(d[9],d[10],20):hx,ax=d[9],d[10]
 L[(league,0)].add(t,hg,ag,hs,as_,hx,ax);L[(league,1)].add(t,ag,hg,as_,hs,ax,hx)
 T[(league,home,0)].add(t,hg,ag,hs,as_,hx,ax);T[(league,away,1)].add(t,ag,hg,as_,hs,ax,hx)
 for team in [home,away]:ELN[(league,team)]+=1
 expectation=1/(1+10**(-(E[home]-E[away]+60)/400));actual=1 if hg>ag else 0 if hg<ag else .5
 delta=20*(actual-expectation);E[home]+=delta;E[away]-=delta
 done.append(f)

grid=np.arange(21);fac=np.array([math.factorial(int(i)) for i in grid],dtype=float)
home_mask=grid[:,None]>grid[None,:];draw_mask=grid[:,None]==grid[None,:];away_mask=grid[:,None]<grid[None,:];over_mask=grid[:,None]+grid[None,:]>=2

def distribution(h,a,elo=None):
 h=min(4.5,max(.15,h));a=min(4.5,max(.15,a));ph=np.exp(-h)*h**grid/fac;pa=np.exp(-a)*a**grid/fac
 joint=np.outer(ph,pa);joint/=joint.sum()
 if elo is not None:
  base=[joint[home_mask].sum(),joint[draw_mask].sum(),joint[away_mask].sum()]
  for mask,p,q in zip([home_mask,draw_mask,away_mask],base,elo):joint[mask]*=(.8*p+.2*q)/p
 H=joint[home_mask].sum();D_=joint[draw_mask].sum();A=joint[away_mask].sum()
 return [float(x) for x in [H,D_,A,H+D_,A+D_,joint[home_mask&over_mask].sum(),joint[away_mask&over_mask].sum(),joint[(home_mask|draw_mask)&over_mask].sum(),joint[(away_mask|draw_mask)&over_mask].sum()]]

def predict(f,cut):
 fid,league,ts,home,away,hg,ag,*_=f
 lh=L[(league,0)].at(cut);la=L[(league,1)].at(cut);h=T[(league,home,0)].at(cut);a=T[(league,away,1)].at(cut)
 baseH=(lh[1]+20*1.5)/(lh[0]+20);baseA=(la[1]+20*1.2)/(la[0]+20)
 def lambdas(prior):
  ah=(h[1]+prior*baseH)/(h[0]+prior)/baseH;da=(a[2]+prior*baseH)/(a[0]+prior)/baseH
  aa=(a[1]+prior*baseA)/(a[0]+prior)/baseA;dh=(h[2]+prior*baseA)/(h[0]+prior)/baseA
  return baseH*ah*da,baseA*aa*dh
 h8,a8=lambdas(8);h4,a4=lambdas(4)
 # League draw rate comes only from completed historical games.
 leaguepast=[x for x in done if x[1]==league and x[2]>cut-365*DAY]
 dr=(sum(x[5]==x[6] for x in leaguepast)+5)/(len(leaguepast)+20)
 ew=1/(1+10**(-(E[home]-E[away]+60)/400));ed=min(.4,max(.1,dr*4*ew*(1-ew)))
 elo=[(1-ed)*ew,ed,(1-ed)*(1-ew)]
 def enrich(index,prior):
  count_i,sum_i,against_i=index,index+1,index+2
  active=h[count_i]>=4 and a[count_i]>=4 and lh[count_i]>=20 and la[count_i]>=20
  if not active:return h8,a8,False
  baseMH=lh[sum_i]/lh[count_i];baseMA=la[sum_i]/la[count_i]
  if min(baseMH,baseMA)<=0:return h8,a8,False
  atkH=(h[sum_i]+prior*baseMH)/(h[count_i]+prior)/baseMH;defA=(a[against_i]+prior*baseMH)/(a[count_i]+prior)/baseMH
  atkA=(a[sum_i]+prior*baseMA)/(a[count_i]+prior)/baseMA;defH=(h[against_i]+prior*baseMA)/(h[count_i]+prior)/baseMA
  return .75*h8+.25*baseH*atkH*defA,.75*a8+.25*baseA*atkA*defH,True
 sh,sa,sactive=enrich(3,8);xh,xa,xactive=enrich(6,8)
 ps=[distribution(baseH,baseA),distribution(h8,a8),distribution(h4,a4),distribution(h8,a8,elo),distribution(sh,sa),distribution(xh,xa)]
 sample=min(ELN[(league,home)],ELN[(league,away)])
 maxinput=max((x[2]+7200000 for x in done),default=0)
 assert maxinput<=cut
 return ps,sample,sactive,xactive,maxinput

if __name__=='__main__':
 protocol={'models':MODELS,'probabilityKeys':KEYS,'development':'calendar 2024; warm-up 2023','evaluation':'calendar 2025; choice frozen after 2024','additional_audit':'2026-01-01 to 2026-10-21','clock':'08:00 Europe/Lisbon of first day; completed result assumed available kickoff+2h','historical_availability':'event-time reconstruction; actual source import/revision availability not verifiable','odds':'No contemporaneous historical prices. No ROI or valid 8–15-odd ticket claim. Ticket checks are probability-only diagnostics.','variants':'League rates control; role-specific goals with shrinkage8 or4; goals8+20% Elo; goals8+25% SOT; goals8+25% xG. No coefficients tuned after evaluation.','decay_half_life_days':180,'source_detail_rejections':rejected,'production_changes':False}
 (ROOT/'protocol.json').write_text(json.dumps(protocol,indent=2))
 start=datetime.date(2024,1,1);end=datetime.date(2026,10,21);records=[]
 for dayno in range((end-start).days+1):
  day=start+datetime.timedelta(days=dayno);cut=int(datetime.datetime.combine(day,datetime.time(8),TZ).timestamp()*1000)
  while idx<len(F) and F[idx][2]+7200000<=cut:update(F[idx],F[idx][2]+7200000);idx+=1
  ending=int(datetime.datetime.combine(day+datetime.timedelta(days=3),datetime.time(0),TZ).timestamp()*1000)
  targets=[f for f in F if cut<f[2]<ending and datetime.datetime.fromtimestamp(f[2]/1000,TZ).date()<=end]
  for f in targets:
   ps,sample,sa,xa,maxinput=predict(f,cut)
   records.append({'start':day.isoformat(),'decision':cut,'id':f[0],'league':f[1],'kickoff':f[2],'home':f[3],'away':f[4],'hg':f[5],'ag':f[6],'ps':ps,'sample':sample,'sot_active':sa,'xg_active':xa,'max_input_completion':maxinput})
  if dayno%90==0:print(json.dumps({'day':str(day),'records':len(records)}),flush=True)
 (ROOT/'predictions.json').write_text(json.dumps(records,separators=(',',':')))
 print(json.dumps({'complete':True,'fixtures':len(F),'records':len(records),'details':len(D)}),flush=True)
