"""Build a fixed xG model grid using only observations known at each decision.
No outcomes of target games enter model estimation; no parameter choice here.
"""
import json,math,datetime,collections,itertools,sys
from pathlib import Path
import numpy as np
ROOT=Path(__file__).parent;WIDE=ROOT.parent/'bigodds-wide';HIST=ROOT.parent/'bigodds-history'
sys.path.insert(0,str(WIDE));import base as original
L=json.loads((WIDE/'legs.json').read_text());POOL=json.loads((WIDE/'pool.json').read_text())
MARKETS={'1':0,'2':2,'1X':3,'X2':4,'1+O15':5,'2+O15':6,'1X+O15':7,'X2+O15':8,'O15':11,'U15':12,'O25':13,'U25':14,'O35':15,'U35':16,'BY':19,'BN':20}
HALF_LIVES=[90,180,365];PRIORS=[2,4,8];WEIGHTS=[.10,.25,.50,.75,1.0];MIN_XG=[2,4];MARKET_MIX=[0,.25,.5]

def states(cut,half):
 league=collections.defaultdict(lambda:np.zeros(4));team=collections.defaultdict(lambda:np.zeros(4));xl=collections.defaultdict(lambda:np.zeros(4));xt=collections.defaultdict(lambda:np.zeros(4));counts=collections.Counter();used=[]
 decay=half*86400000/math.log(2)
 def add(mapping,key,w,gf,ga):mapping[key]+=np.array([w,w*gf,w*ga,1])
 for f in original.F:
  end=f[2]+7200000
  if end>cut:break
  w=math.exp(-(cut-end)/decay);lg,h,a=f[1],f[3],f[4]
  add(league,(lg,0),w,f[5],f[6]);add(league,(lg,1),w,f[6],f[5]);add(team,(lg,h,0),w,f[5],f[6]);add(team,(lg,a,1),w,f[6],f[5]);counts[(lg,h)]+=1;counts[(lg,a)]+=1
  d=original.D.get(f[0])
  if not d or d[2]>cut or not original.validpair(d[9],d[10],20):continue
  add(xl,(lg,0),w,d[9],d[10]);add(xl,(lg,1),w,d[10],d[9]);add(xt,(lg,h,0),w,d[9],d[10]);add(xt,(lg,a,1),w,d[10],d[9]);used.append([f[0],end,d[2]])
 return league,team,xl,xt,counts,used

def run():
 primary=[]
 for half,prior in itertools.product(HALF_LIVES,PRIORS):
  primary.append(dict(half_life=half,prior=prior,xg_weight=0,min_xg_role=0))
  for weight,minimum in itertools.product(WEIGHTS,MIN_XG):primary.append(dict(half_life=half,prior=prior,xg_weight=weight,min_xg_role=minimum))
 models=[]
 for p in primary:
  for mix in MARKET_MIX:models.append(dict(p,market_mix=mix))
 # Build each fixture/decision model once, then fan out to bookmaker market quotes.
 keys=sorted({(l['decision'],l['id']) for l in L});key_index={k:i for i,k in enumerate(keys)}
 probs=np.empty((len(primary),len(keys),21));active=np.zeros((len(primary),len(keys)),dtype=bool);directions=np.zeros((len(primary),len(keys)),dtype=np.int8);metadata=[]
 for cut,group in itertools.groupby(keys,key=lambda k:k[0]):
  targets=list(group)
  for half in HALF_LIVES:
   league,team,xl,xt,counts,used=states(cut,half)
   assert all(end<=cut and observed<=cut for _,end,observed in used)
   metadata.append({'decision':cut,'half_life':half,'xg_inputs':len(used),'max_xg_observed':max((x[2] for x in used),default=0),'max_xg_completion':max((x[1] for x in used),default=0)})
   for _,fid in targets:
    f=original.FD[fid];lg,h,a=f[1],f[3],f[4];assert f[2]>cut
    lh=league[(lg,0)];la=league[(lg,1)];th=team[(lg,h,0)];ta=team[(lg,a,1)];bh=(lh[1]+30)/(lh[0]+20);ba=(la[1]+24)/(la[0]+20)
    xlh=xl[(lg,0)];xla=xl[(lg,1)];xh=xt[(lg,h,0)];xa=xt[(lg,a,1)]
    for pi,p in enumerate(primary):
     if p['half_life']!=half:continue
     prior=p['prior'];gh=bh*((th[1]+prior*bh)/(th[0]+prior)/bh)*((ta[2]+prior*bh)/(ta[0]+prior)/bh);ga=ba*((ta[1]+prior*ba)/(ta[0]+prior)/ba)*((th[2]+prior*ba)/(th[0]+prior)/ba)
     eligible=p['xg_weight']>0 and min(xlh[0],xla[0])>=20 and min(xh[0],xa[0])>=p['min_xg_role']
     if eligible:
      bxh=xlh[1]/xlh[0];bxa=xla[1]/xla[0];eligible=min(bxh,bxa)>0
      if eligible:
       xgh=bh*((xh[1]+prior*bxh)/(xh[0]+prior)/bxh)*((xa[2]+prior*bxh)/(xa[0]+prior)/bxh);xga=ba*((xa[1]+prior*bxa)/(xa[0]+prior)/bxa)*((xh[2]+prior*bxa)/(xh[0]+prior)/bxa)
       weight=p['xg_weight'];gh=(1-weight)*gh+weight*xgh;ga=(1-weight)*ga+weight*xga
     ki=key_index[(cut,fid)];v=original.distribution(gh,ga);probs[pi,ki]=v;active[pi,ki]=eligible;directions[pi,ki]=1 if v[3]>=v[4] else 2
 leg_keys=np.array([key_index[(l['decision'],l['id'])] for l in L]);market_indices=np.array([MARKETS[l['market']] for l in L]);mp=np.array([l['ps'][0] for l in L]);arrays=[];asets=[];ds=[]
 for mi,m in enumerate(models):
  pi=mi//len(MARKET_MIX);mix=m['market_mix'];p=probs[pi,leg_keys,market_indices];arrays.append((1-mix)*p+mix*mp);asets.append(active[pi,leg_keys]);ds.append(directions[pi,leg_keys])
 np.savez_compressed(ROOT/'models.npz',probabilities=np.array(arrays),active=np.array(asets),direction=np.array(ds))
 (ROOT/'models.json').write_text(json.dumps(models,indent=2));(ROOT/'clock-audit.json').write_text(json.dumps(metadata,indent=2));(ROOT/'fixture-models.json').write_text(json.dumps({'keys':keys,'primary':primary,'probabilities':probs.tolist(),'active':active.tolist()},separators=(',',':')))
 # Independent reproduction of the original no-xG reference.
 ref=next(i for i,m in enumerate(models) if m==dict(half_life=180,prior=4,xg_weight=0,min_xg_role=0,market_mix=0))
 assert np.max(np.abs(np.array(arrays)[ref]-np.array([l['ps'][3] for l in L])))<1e-11
 print(json.dumps({'models':len(models),'primary_models':len(primary),'fixture_windows':len(keys),'legs':len(L),'baseline_max_error':float(np.max(np.abs(np.array(arrays)[ref]-np.array([l['ps'][3] for l in L]))))}),flush=True)
if __name__=='__main__':run()
