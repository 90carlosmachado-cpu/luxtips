"""Exhaustive evaluation of a predefined finite policy grid, not all possible rules.
Real archived odds only. Ranking uses probabilities/prices, never outcomes.
"""
import json,math,itertools,datetime,csv,time,os,concurrent.futures,collections
from pathlib import Path
import numpy as np
ROOT=Path(__file__).parent;BASE=ROOT.parent/'bigodds-wide'
L=json.loads((BASE/'legs.json').read_text());POOL=json.loads((BASE/'pool.json').read_text());MODELS=json.loads((ROOT/'models.json').read_text());Z=np.load(ROOT/'models.npz');ALLP=Z['probabilities'];ALLA=Z['active'];ALLD=Z['direction']
MARKET_SETS={'all_real':set(['1','2','1X','X2','O15','O25','O35','U15','U25','U35','BY','BN']),'no_unders':set(['1','2','1X','X2','O15','O25','O35','BY','BN']),'sides':set(['1','2','1X','X2']),'goals':set(['O15','O25','O35','U15','U25','U35'])}
PMIN=[.5,.65,.8];ODDMIN=[1.05,1.2];SAMPLEMIN=[0,12];RANKS=['probability','efficiency','edge'];XG_MODES=['fallback','required'];DIRECTIONS=['any','fixed'];SPANS=[1,2,3];COUNTS=[(5,12),(8,12)]
BASE_RULES=list(itertools.product(MARKET_SETS,PMIN,ODDMIN,SAMPLEMIN,RANKS,XG_MODES,DIRECTIONS));PER_MODEL=len(BASE_RULES)*len(SPANS)*len(COUNTS)
N=len(L);PAD=N;odd=np.array([l['odd'] for l in L]+[1.]);logodd=np.log(odd);hit=np.array([l['hit'] for l in L]+[0]);sample=np.array([l['sample'] for l in L]+[0]);side=np.array([1 if l['market'] in ['1','1X','1+O15','1X+O15'] else 2 if l['market'] in ['2','X2','2+O15','X2+O15'] else 0 for l in L]+[0]);indices=np.arange(N+1)
GROUPS=[];BOOKS=[];DAYS=sorted(POOL)
for di,day in enumerate(DAYS):
 for book,groups in POOL[day].items():
  group_ids=[]
  for g in groups:group_ids.append(len(GROUPS));GROUPS.append(g)
  BOOKS.append({'day':day,'di':di,'book':book,'groups':group_ids})
G=np.full((len(GROUPS),max(map(len,GROUPS))),PAD,dtype=int)
for i,g in enumerate(GROUPS):G[i,:len(g)]=g
BPAD=len(GROUPS);B=np.full((len(BOOKS),max(len(b['groups']) for b in BOOKS)),BPAD,dtype=int)
for i,b in enumerate(BOOKS):B[i,:len(b['groups'])]=b['groups']
BOOKROWS=[np.array([i for i,b in enumerate(BOOKS) if b['di']==di]) for di in range(len(DAYS))]
LEG_DELTA=np.array([(datetime.date.fromisoformat(l['day'])-datetime.date.fromtimestamp(l['decision']/1000)).days for l in L]+[99])
# decision UTC date equals Lisbon date at 08h in this data.
for l in L:assert datetime.date.fromtimestamp(l['decision']/1000).isoformat() in DAYS
ALLOWED={name:np.array([l['market'] in codes and not l['estimated'] for l in L]+[False]) for name,codes in MARKET_SETS.items()}
COLUMNS=['id','model','markets','pmin','oddmin','samplemin','ranking','xg_mode','direction','span','nmin','nmax','n','wins','train_n','train_wins','eval_n','eval_wins','xg_legs','legs','mean_odd']

def rule_dict(mi,base,span,profile):
 markets,pmin,omin,smin,rank,xg_mode,direction=base
 return dict(model=MODELS[mi],markets=markets,p_min=pmin,odd_min=omin,sample_min=smin,ranking=rank,xg_mode=xg_mode,direction=direction,span=span,n_min=profile[0],n_max=profile[1],odd_band=[8,15])

def prepare(mi):
 P=np.r_[ALLP[mi],0.];A=np.r_[ALLA[mi],False];D=np.r_[ALLD[mi],0]
 scores={'probability':P,'edge':P*odd,'efficiency':np.divide(np.log(np.maximum(P,1e-15)),logodd,out=np.full(N+1,-np.inf),where=logodd>0)}
 orders={}
 for rank,score in scores.items():
  order=np.lexsort((G,-P[G],-score[G]),axis=1);orders[rank]=np.take_along_axis(G,order,axis=1)
 return P,A,D,scores,orders

def ordered_books(mi,base,prepared):
 P,A,D,scores,orders=prepared;market,pmin,omin,smin,rank,xg_mode,direction=base
 allowed=ALLOWED[market]&(P>=pmin)&(odd>=omin)&(sample>=smin)
 if xg_mode=='required':allowed&=A
 if direction=='fixed':allowed&=((side==0)|(side==D))
 ordered=orders[rank];eligible=allowed[ordered];positions=np.argmax(eligible,axis=1);chosen=ordered[np.arange(len(G)),positions];chosen[~eligible.any(axis=1)]=PAD
 chosen=np.r_[chosen,PAD];bybook=chosen[B];valid=bybook!=PAD;score=scores[rank]
 order=np.lexsort((bybook,-P[bybook],np.where(valid,-score[bybook],np.inf)),axis=1)
 return np.take_along_axis(bybook,order,axis=1)

def tickets_for(mi,base,span,profile,prepared,bybook=None):
 P,A,D,scores,orders=prepared
 if bybook is None:bybook=ordered_books(mi,base,prepared)
 valid=(bybook!=PAD)&(LEG_DELTA[bybook]<span)
 compact=np.take_along_axis(bybook,np.argsort(~valid,axis=1,kind='stable'),axis=1)[:,:12]
 valid=np.take_along_axis(valid,np.argsort(~valid,axis=1,kind='stable'),axis=1)[:,:12]
 # Invalid rows may carry a real leg excluded by span. Mask before accumulating.
 ids=np.where(valid,compact,PAD);lp=np.cumsum(np.log(np.maximum(P[ids],1e-15)),axis=1);lo=np.cumsum(logodd[ids],axis=1);ns=np.arange(1,ids.shape[1]+1)
 eligible=valid&(ns>=profile[0])&(ns<=profile[1])&(lo>=math.log(8)-1e-12)&(lo<=math.log(15)+1e-12)
 scores=np.where(eligible,lp,-np.inf);out=[]
 for di,rows in enumerate(BOOKROWS):
  last=(datetime.date.fromisoformat(DAYS[di])+datetime.timedelta(days=span-1)).isoformat()
  if last>'2026-11-04':continue
  block=scores[rows];flat=int(np.argmax(block));ri,ci=np.unravel_index(flat,block.shape)
  if not math.isfinite(float(block[ri,ci])):continue
  row=int(rows[ri]);chosen=ids[row,:ci+1].tolist()
  out.append({'start':DAYS[di],'last':last,'book':BOOKS[row]['book'],'odd':float(math.exp(lo[row,ci])),'p':float(math.exp(lp[row,ci])),'legs':chosen,'hit':int(all(hit[i] for i in chosen)),'xg_legs':int(A[chosen].sum())})
 return out

def aggregate(ts):
 n=len(ts);legs=sum(len(t['legs']) for t in ts);xg=sum(t['xg_legs'] for t in ts)
 return {'n':n,'wins':sum(t['hit'] for t in ts),'rate':sum(t['hit'] for t in ts)/n if n else None,'mean_odd':sum(t['odd'] for t in ts)/n if n else None,'legs':legs,'xg_legs':xg,'xg_share':xg/legs if legs else 0}

def categories(ts):return aggregate(ts),aggregate([t for t in ts if t['last']<='2026-10-29']),aggregate([t for t in ts if t['start']>='2026-10-30'])

def work(mi):
 prepared=prepare(mi);model=MODELS[mi];positive=model['xg_weight']>0;best_full=None;best_train=None;lines=[];count=0
 for bi,base in enumerate(BASE_RULES):
  bybook=ordered_books(mi,base,prepared)
  for si,span in enumerate(SPANS):
   for ci,profile in enumerate(COUNTS):
    pid=mi*PER_MODEL+bi*len(SPANS)*len(COUNTS)+si*len(COUNTS)+ci;ts=tickets_for(mi,base,span,profile,prepared,bybook);full,train,evaluation=categories(ts)
    fields=[pid,mi,*base,span,*profile,full['n'],full['wins'],train['n'],train['wins'],evaluation['n'],evaluation['wins'],full['xg_legs'],full['legs'],round(full['mean_odd'] or 0,8)]
    lines.append(','.join(map(str,fields))+'\n');count+=1
    # Fairly sized full-period diagnostic, requiring real xG contribution.
    enough_xg=not positive or full['xg_share']>=.5
    if full['n']>=8 and enough_xg:
     key=(full['wins']/full['n'],full['n'],-pid)
     if best_full is None or key>best_full[0]:best_full=(key,dict(id=pid,rule=rule_dict(mi,base,span,profile),all=full,train=train,evaluation=evaluation,tickets=ts))
    if train['n']>=3 and (not positive or train['xg_share']>=.5):
     key=((train['wins']+1)/(train['n']+2),train['n'],-pid)
     if best_train is None or key>best_train[0]:best_train=(key,dict(id=pid,rule=rule_dict(mi,base,span,profile),all=full,train=train,evaluation=evaluation,tickets=ts))
 (ROOT/'policies'/f'{mi:03}.csv').write_text(''.join(lines))
 return {'model':mi,'count':count,'positive_xg':positive,'full':best_full,'train':best_train}

def run():
 (ROOT/'policies').mkdir(exist_ok=True);start=time.time();best={};done=0;count=0
 workers=min(4,len(os.sched_getaffinity(0)))
 with concurrent.futures.ProcessPoolExecutor(max_workers=workers) as pool:
  futures={pool.submit(work,mi):mi for mi in range(len(MODELS))}
  for future in concurrent.futures.as_completed(futures):
   r=future.result();done+=1;count+=r['count'];kind='xg' if r['positive_xg'] else 'control'
   for which in ['full','train']:
    entry=r[which];key=(kind,which)
    if entry and (key not in best or tuple(entry[0])>tuple(best[key][0])):best[key]=entry
   if done%10==0 or done==len(MODELS):print(json.dumps({'models_done':done,'models_total':len(MODELS),'policies':count,'seconds':round(time.time()-start,1),'best_xg_full':best.get(('xg','full'),[None,{}])[1].get('all'),'best_xg_train_evaluation':best.get(('xg','train'),[None,{}])[1].get('evaluation')}),flush=True)
 protocol={'models':len(MODELS),'policies':count,'half_lives':[90,180,365],'priors':[2,4,8],'xg_weights':[.1,.25,.5,.75,1.0],'minimum_xg_role_weighted_samples':[2,4],'market_blend':[0,.25,.5],'markets':list(MARKET_SETS),'p_min':PMIN,'odd_min':ODDMIN,'sample_min':SAMPLEMIN,'rankings':RANKS,'xg_modes':XG_MODES,'directions':DIRECTIONS,'days':SPANS,'leg_profiles':COUNTS,'odds_band':[8,15],'full_diagnostic':'>=8 tickets and >=50% actual xG-active leg appearances for xG candidates; maximize wins/n, ties more tickets then earlier fixed policy id','training_selection':'training windows end <=29Oct; >=3 tickets; >=50% xG-active training leg appearances; maximize (wins+1)/(n+2), ties more training tickets then earlier id; evaluation outcomes never used','evaluation':'windows start >=30Oct and end <=4Nov; overlapping boundary windows excluded from both splits','caveat':'All dates have already been inspected in earlier research. This is an exploratory chronological split, NOT a fresh independent holdout. Overlapping tickets reuse outcomes. Large multiple-testing risk. No production change.','availability':'xG observed_at and kickoff+2h <= decision; old scores availability assumed kickoff+2h as original study; no xG imputation','real_prices_only':True,'search_scope':'All configurations of this finite grid; greedy market-per-fixture then ranked prefixes, not all possible combinations of games.'}
 out={'protocol':protocol,'leaders':{kind+'_'+which:entry[1] for (kind,which),entry in best.items()},'seconds':time.time()-start,'workers':workers}
 (ROOT/'results.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
 with (ROOT/'all-policies.csv').open('w') as f:
  f.write(','.join(COLUMNS)+'\n')
  for path in sorted((ROOT/'policies').glob('*.csv')):f.write(path.read_text())
 print(json.dumps({'complete':True,'policies':count,'seconds':round(time.time()-start,1),'leaders':{k:{'rule':v['rule'],'all':v['all'],'train':v['train'],'evaluation':v['evaluation']} for k,v in out['leaders'].items()}},ensure_ascii=False),flush=True)
if __name__=='__main__':run()
