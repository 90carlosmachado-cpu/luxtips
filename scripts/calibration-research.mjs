// Offline research only. This module is never imported by the Worker.
import {grid} from '../src/legacy-worker.mjs';
const KEYS=['H','D','A'];
export function calibrate(probabilities,alpha=1){
 if(!Number.isFinite(alpha)||alpha<.5||alpha>2)throw Error('invalid_calibration_alpha');
 if(!KEYS.every(k=>Number.isFinite(probabilities?.[k])&&probabilities[k]>0&&probabilities[k]<1)||Math.abs(KEYS.reduce((s,k)=>s+probabilities[k],0)-1)>1e-6)throw Error('invalid_calibration_distribution');
 if(alpha===1)return Object.fromEntries(KEYS.map(k=>[k,probabilities[k]]));
 const values=KEYS.map(k=>probabilities[k]**alpha),sum=values.reduce((a,b)=>a+b,0);
 return Object.fromEntries(KEYS.map((k,i)=>[k,values[i]/sum]));
}
export const result=r=>r.hg>r.ag?'H':r.hg<r.ag?'A':'D';
export function calibratedGame(g,alpha){
 const p=g.prediction;
 if(!p?.components?.length)throw Error('missing_calibration_components');
 const corrected=calibrate(p.probabilities,alpha),components=p.components.map(c=>calibrate(grid(c.homeGoals,c.awayGoals),alpha));
 // Never obtain eligibility by reducing the existing divergence reserve.
 const spread={...p.contextAdjustment.uncertainty.spread};
 for(const k of KEYS)spread[k]=Math.max(spread[k],Math.max(...components.map(c=>c[k]))-Math.min(...components.map(c=>c[k])));
 return {...g,prediction:{...p,probabilities:{...p.probabilities,...corrected},contextAdjustment:{...p.contextAdjustment,uncertainty:{...p.contextAdjustment.uncertainty,spread}}}};
}
export function fitCalibration(rows,before){
 if(!Number.isFinite(before))throw Error('missing_calibration_cutoff');
 const used=rows.filter(r=>r.sample>=12&&r.ts+7200000<before);
 if(used.length<200)return {alpha:1,n:used.length,status:'insufficient_calibration_sample',before};
 const losses=Array.from({length:151},(_,i)=>{const alpha=(50+i)/100;return {alpha,loss:used.reduce((s,r)=>s-Math.log(calibrate(r.probabilities,alpha)[result(r)]),0)/used.length};});
 losses.sort((a,b)=>a.loss-b.loss||Math.abs(a.alpha-1)-Math.abs(b.alpha-1));
 return {alpha:losses[0].alpha,loss:losses[0].loss,n:used.length,maxTrainingKickoff:Math.max(...used.map(r=>r.ts)),before,status:'fitted'};
}
export function scores(rows,alpha=1){
 if(!rows.length)return {n:0};
 let logLoss=0,brier=0,favoriteLogLoss=0,favoriteBrier=0,favoriteP=0,wins=0,drawBrier=0;
 const bins=Array.from({length:10},(_,i)=>({low:i/10,high:(i+1)/10,n:0,sum:0,wins:0}));
 for(const r of rows){
  const p=calibrate(r.probabilities,alpha),y=result(r),m=r.probabilities.H>=r.probabilities.A?'H':'A',win=+(m===y),q=p[m];
  logLoss-=Math.log(p[y]);brier+=KEYS.reduce((s,k)=>s+(p[k]-+(y===k))**2,0);drawBrier+=(p.D-+(y==='D'))**2;
  favoriteLogLoss-=win*Math.log(q)+(1-win)*Math.log(1-q);favoriteBrier+=(q-win)**2;favoriteP+=q;wins+=win;
  const bin=bins[Math.min(9,Math.floor(q*10))];bin.n++;bin.sum+=q;bin.wins+=win;
 }
 const n=rows.length;
 return {n,logLoss:logLoss/n,brier:brier/n,drawBrier:drawBrier/n,favoriteLogLoss:favoriteLogLoss/n,favoriteBrier:favoriteBrier/n,meanFavoriteProbability:favoriteP/n,observedWinRate:wins/n,favoriteBias:wins/n-favoriteP/n,ece:bins.reduce((s,b)=>s+Math.abs(b.sum-b.wins),0)/n,bins:bins.map(b=>({low:b.low,high:b.high,n:b.n,mean:b.n?b.sum/b.n:null,frequency:b.n?b.wins/b.n:null}))};
}
export function pairedInterval(rows,alphas,blockDays=7){
 const blocks=new Map();for(let i=0;i<rows.length;i++){
  const r=rows[i],key=Math.floor(r.ts/(blockDays*86400000)),y=result(r),d=-Math.log(calibrate(r.probabilities,typeof alphas==='number'?alphas:alphas[i])[y])+Math.log(r.probabilities[y]);
  if(!blocks.has(key))blocks.set(key,{n:0,sum:0});const b=blocks.get(key);b.n++;b.sum+=d;
 }
 const values=[...blocks.values()];if(!values.length)return {n:0};
 const samples=[];let seed=23102026;const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 for(let i=0;i<10000;i++){let n=0,sum=0;for(let j=0;j<values.length;j++){const v=values[Math.floor(rand()*values.length)];n+=v.n;sum+=v.sum;}samples.push(sum/n);}
 samples.sort((a,b)=>a-b);return {n:rows.length,blocks:values.length,blockDays,meanDifference:values.reduce((s,b)=>s+b.sum,0)/rows.length,interval95:rows.length>=30&&values.length>=15?[samples[250],samples[9749]]:null,replicates:10000};
}
