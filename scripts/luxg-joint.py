"""Development-only maximum-entropy correction of the entire score distribution."""
import json,pathlib
import numpy as np
from scipy.optimize import minimize
from scipy.special import gammaln,logsumexp
from importlib.machinery import SourceFileLoader
R=pathlib.Path(__file__).resolve().parents[1]
T=SourceFileLoader('luxg_train',str(R/'scripts/luxg-train.py')).load_module()
D=T.D;MAX=30;hh,aa=np.indices((MAX+1,MAX+1));h=hh.ravel();a=aa.ravel()

def setup(mu):
    logbase=-mu[:,0,None]+h*np.log(mu[:,0,None])-gammaln(h+1)-mu[:,1,None]+a*np.log(mu[:,1,None])-gammaln(a+1)
    features=np.stack([logbase,np.broadcast_to(h+a,logbase.shape),np.broadcast_to(h-a,logbase.shape),np.broadcast_to(h==a,logbase.shape),np.broadcast_to((h==0).astype(float)+(a==0),logbase.shape)],axis=2)
    return logbase,features

def joint_p(params,mu):
    lb,F=setup(mu);theta=np.zeros(5);theta[params['indices']]=params['coefficients'];lw=lb+F@theta;return np.exp(lw-logsumexp(lw,axis=1)[:,None]).reshape(len(mu),MAX+1,MAX+1)

def metrics(params,mu,y):
    J=joint_p(params,mu);ix=np.arange(len(y));P=np.stack([J[:,hh>aa].sum(axis=1),J[:,hh==aa].sum(axis=1),J[:,hh<aa].sum(axis=1)],axis=1);target=np.where(y[:,0]>y[:,1],0,np.where(y[:,0]==y[:,1],1,2));mx=P.max(axis=1);wins=P.argmax(axis=1)==target;flat=J.reshape(len(y),-1);order=np.argsort(-flat,axis=1,kind='stable')[:,:3];actual=y[:,0]*(MAX+1)+y[:,1];eg=np.stack([(J*hh).sum(axis=(1,2)),(J*aa).sum(axis=(1,2))],axis=1)
    loss=-np.log(np.maximum(1e-12,J[ix,y[:,0],y[:,1]]));brier=np.sum((P-np.eye(3)[target])**2,axis=1);ll=-np.log(np.maximum(1e-12,P[ix,target]));ece=sum(abs(float(mx[(mx>=i/10)&(mx<(i+1)/10)].sum())-float(wins[(mx>=i/10)&(mx<(i+1)/10)].sum())) for i in range(10))/len(y)
    return {'n':len(y),'scoreLogLoss':float(loss.mean()),'brier1X2':float(brier.mean()),'logLoss1X2':float(ll.mean()),'accuracy1X2':float(wins.mean()),'ece1X2':ece,'exactScoreAccuracy':float((order[:,0]==actual).mean()),'topThreeScoresAccuracy':float((order==actual[:,None]).any(axis=1).mean()),'goalMAE':float(np.abs(eg-y).mean()),'goalMeanPredicted':eg.mean(axis=0).tolist(),'goalMeanObserved':y.mean(axis=0).tolist()},loss,brier,ll

def run():
    train=[r for r in D['rows'] if r['season']<=2024 and r['sample']>=12];dev=[r for r in D['rows'] if r['season']==2025 and r['sample']>=12]
    X,mu,y=T.matrices(train);Xd,md,yd=T.matrices(dev);lb,F=setup(mu);ix=np.arange(len(y));target=y[:,0]*(MAX+1)+y[:,1]
    candidates=[]
    for panel,indices in {'dispersion':[0],'joint':[0,1,2,3],'zero':[0,1,2,3,4]}.items():
      FF=F[:,:,indices];observed=FF[ix,target,:];mean_observed=observed.mean(axis=0)
      for alpha in [.01,.1,1]:
        def objective(theta):
            lw=lb+FF@theta;norm=logsumexp(lw,axis=1);q=np.exp(lw-norm[:,None]);value=float((norm-lw[ix,target]).mean()+alpha/2*np.sum(theta**2));grad=np.einsum('nk,nkj->j',q,FF)/len(y)-mean_observed+alpha*theta;return value,grad
        opt=minimize(objective,np.zeros(len(indices)),jac=True,method='L-BFGS-B',bounds=[(-.25,.25)]*len(indices),options={'maxiter':500,'ftol':1e-12,'gtol':1e-8})
        if not opt.success:raise RuntimeError(opt.message)
        params={'kind':'jointTilt','panel':panel,'indices':indices,'coefficients':opt.x.tolist(),'ridge':alpha,'maxGoals':MAX}
        m,*_=metrics(params,md,yd);candidates.append({'id':f'tilt-{panel}-ridge{alpha}','params':params,'development':m})
    lock=json.loads((R/'data/luxg-candidate-lock.json').read_text());base=lock['baselineDevelopment'];old=json.loads((R/'src/luxg-development.json').read_text());all_candidates=old['candidates']+candidates
    qualifying=[r for r in all_candidates if base['scoreLogLoss']-r['development']['scoreLogLoss']>=.005 and r['development']['brier1X2']<=base['brier1X2']+.001 and r['development']['goalMAE']<=base['goalMAE']+.01]
    selected=None
    if qualifying:
        best=min(r['development']['scoreLogLoss'] for r in qualifying);near=[r for r in qualifying if r['development']['scoreLogLoss']<=best+.002];selected=min(near,key=lambda r:(len(r['params']['indices']),r['params'].get('rho',0)!=0,-r['params']['ridge']))
    lock['selected']=selected;lock['bestExperimental']=min(all_candidates,key=lambda r:r['development']['scoreLogLoss']);lock['protocol']=json.loads((R/'scripts/luxg-protocol.json').read_text())
    (R/'src/luxg-development.json').write_text(json.dumps({'baseline':base,'candidates':all_candidates},indent=2)+'\n');(R/'data/luxg-candidate-lock.json').write_text(json.dumps(lock,indent=2)+'\n');print(json.dumps({'selected':selected,'bestExperimental':lock['bestExperimental'],'baseline':base},indent=2),flush=True)
if __name__=='__main__':run()
