"""Fit fixed candidates on seasons <=2024 and select on 2025. Never score 2026."""
import json, pathlib, hashlib
import numpy as np
from scipy.optimize import minimize, minimize_scalar
from scipy.special import gammaln
ROOT=pathlib.Path(__file__).resolve().parents[1]
D=json.loads((ROOT/'data/luxg-training.json').read_text())
PANELS={'calibration':[0,1,2],'strength':[0,1,2,3,4,10,11,12,13,14,15],'context':list(range(16))}

def matrices(rows):
    return np.array([r['features'] for r in rows],float),np.array([r['base'] for r in rows],float),np.array([[r['hg'],r['ag']] for r in rows],int)

def means(params,X,base):
    if not params:return base.copy()
    Z=(X[:,:,params['indices']]-np.array(params['center']))/np.array(params['scale'])
    shift=np.clip(Z@np.array(params['coefficients']),-.7,.7)
    return np.exp(np.clip(np.log(base)+shift,np.log(.15),np.log(5)))

def correlation(rho,mu):
    return np.maximum(-.99/np.max(mu,axis=1),np.minimum(.99/np.prod(mu,axis=1),rho))

def tau_at(rho,mu,y):
    r=correlation(rho,mu);h,a=mu[:,0],mu[:,1];x,z=y[:,0],y[:,1]
    return np.where((x==0)&(z==0),1-h*a*r,np.where((x==0)&(z==1),1+h*r,np.where((x==1)&(z==0),1+a*r,np.where((x==1)&(z==1),1-r,1))))

def distribution(mu,rho=0):
    k=np.arange(23)
    pmf=np.exp(-mu[:,:,None]+k*np.log(mu[:,:,None])-gammaln(k+1))
    joint=pmf[:,0,:,None]*pmf[:,1,None,:]
    r=correlation(rho,mu);h,a=mu[:,0],mu[:,1]
    joint[:,0,0]*=1-h*a*r;joint[:,0,1]*=1+h*r;joint[:,1,0]*=1+a*r;joint[:,1,1]*=1-r
    joint/=joint.sum(axis=(1,2))[:,None,None]
    home,away=np.indices((23,23));P=np.stack([joint[:,home>away].sum(axis=1),joint[:,home==away].sum(axis=1),joint[:,home<away].sum(axis=1)],axis=1)
    return joint,P,pmf

def losses(mu,y,rho=0):
    joint,P,pmf=distribution(mu,rho);target=np.where(y[:,0]>y[:,1],0,np.where(y[:,0]==y[:,1],1,2));one=np.eye(3)[target]
    return -np.log(np.maximum(1e-12,joint[np.arange(len(y)),y[:,0],y[:,1]])),np.sum((P-one)**2,axis=1),-np.log(np.maximum(1e-12,P[np.arange(len(y)),target]))

def metric(mu,y,rho=0):
    joint,P,pmf=distribution(mu,rho);target=np.where(y[:,0]>y[:,1],0,np.where(y[:,0]==y[:,1],1,2));chosen=P.argmax(axis=1);wins=(chosen==target);mx=P.max(axis=1)
    jl,b,ll=losses(mu,y,rho);flat=joint.reshape(len(y),-1);order=np.argsort(-flat,axis=1,kind='stable')[:,:3];actual=y[:,0]*23+y[:,1]
    ece=sum(abs(float(mx[(mx>=i/10)&(mx<(i+1)/10)].sum())-float(wins[(mx>=i/10)&(mx<(i+1)/10)].sum())) for i in range(10))/len(y)
    cdf=pmf.cumsum(axis=2);lo=(cdf<.1).sum(axis=2);hi=(cdf<.9).sum(axis=2)
    return {'n':len(y),'scoreLogLoss':float(jl.mean()),'brier1X2':float(b.mean()),'logLoss1X2':float(ll.mean()),'accuracy1X2':float(wins.mean()),'ece1X2':ece,'exactScoreAccuracy':float((order[:,0]==actual).mean()),'topThreeScoresAccuracy':float((order==actual[:,None]).any(axis=1).mean()),'goalMAE':float(np.abs(mu-y).mean()),'goalMeanPredicted':mu.mean(axis=0).tolist(),'goalMeanObserved':y.mean(axis=0).tolist(),'goalIntervalCoverage80':((y>=lo)&(y<=hi)).mean(axis=0).tolist()}

def run():
    train=[r for r in D['rows'] if r['season']<=2024 and r['sample']>=12]
    dev=[r for r in D['rows'] if r['season']==2025 and r['sample']>=12]
    X,base,y=matrices(train);Xd,bd,yd=matrices(dev)
    baseline=metric(bd,yd);results=[]
    for panel,indices in PANELS.items():
      raw=X[:,:,indices].reshape(-1,len(indices));yy=y.ravel();offset=np.log(base.ravel())
      center=raw.mean(axis=0);scale=raw.std(axis=0);scale[scale<1e-8]=1;center[0]=0;scale[0]=1
      Z=(raw-center)/scale;penalty=np.ones(len(indices));penalty[0]=0
      for alpha in [.01,.1,1]:
        def objective(beta):
            raw_shift=Z@beta;shift=np.clip(raw_shift,-.7,.7);eta=np.clip(offset+shift,np.log(.15),np.log(5));mu=np.exp(eta)
            active=(np.abs(raw_shift)<.7)&((offset+shift)>np.log(.15))&((offset+shift)<np.log(5))
            value=np.mean(mu-yy*eta)+alpha/2*np.sum(penalty*beta*beta)
            grad=Z.T@((mu-yy)*active)/len(yy)+alpha*penalty*beta
            return value,grad
        opt=minimize(objective,np.zeros(len(indices)),jac=True,method='L-BFGS-B',bounds=[(-1.5,1.5)]*len(indices),options={'maxiter':1000,'ftol':1e-12,'gtol':1e-8})
        if not opt.success:raise RuntimeError(opt.message)
        params={'panel':panel,'indices':indices,'ridge':alpha,'center':center.tolist(),'scale':scale.tolist(),'coefficients':opt.x.tolist(),'rho':0}
        mt=means(params,X,base);fit_rho=minimize_scalar(lambda rho:float(-np.log(tau_at(rho,mt,y)).mean()),bounds=(-.15,.15),method='bounded',options={'xatol':1e-8}).x
        for correlated in [False,True]:
            p={**params,'rho':float(fit_rho) if correlated else 0}
            results.append({'id':f'{panel}-ridge{alpha}'+('-dc' if correlated else ''),'params':p,'development':metric(means(p,Xd,bd),yd)})
    qualifying=[r for r in results if baseline['scoreLogLoss']-r['development']['scoreLogLoss']>=.005 and r['development']['brier1X2']<=baseline['brier1X2']+.001]
    best=min(results,key=lambda r:r['development']['scoreLogLoss'])
    selected=None
    if qualifying:
        score=min(r['development']['scoreLogLoss'] for r in qualifying)
        near=[r for r in qualifying if r['development']['scoreLogLoss']<=score+.002]
        selected=min(near,key=lambda r:(len(r['params']['indices']),r['params']['rho']!=0,-r['params']['ridge']))
    lock={'version':'luxg-1','selected':selected,'bestExperimental':best,'baselineDevelopment':baseline,'trainMatches':len(train),'developmentMatches':len(dev),'datasetHash':D['datasetHash'],'featureNames':D['features'],'protocol':json.loads((ROOT/'scripts/luxg-protocol.json').read_text())}
    (ROOT/'src/luxg-development.json').write_text(json.dumps({'baseline':baseline,'candidates':results},indent=2)+'\n')
    (ROOT/'data/luxg-candidate-lock.json').write_text(json.dumps(lock,indent=2)+'\n')
    print(json.dumps({'train':len(train),'development':len(dev),'baseline':baseline,'selected':selected,'bestExperimental':best},indent=2),flush=True)
if __name__=='__main__':run()
