import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {calibrate,fitCalibration,scores,pairedInterval} from './calibration-research.mjs';
const source=fs.readFileSync('work/research-strength/predictions.json','utf8'),data=JSON.parse(source);
const rows=year=>data[year]['xg50-prior4'];
const protocol={createdAt:new Date().toISOString(),sourceHash:createHash('sha256').update(source).digest('hex'),model:'frozen strength-prior4 adaptive-xG50 research core',candidate:'one pooled multiclass power/temperature parameter: q[k]=p[k]^alpha / sum(p^alpha)',range:{min:.5,max:2,step:.01},fit:'minimize multiclass log loss on season 2024 sample>=12, before first 2025 kickoff; no league-specific fits',evaluation:'2025 fixed coefficient; second check refits monthly using only earlier completed matches; 2026 descriptive and already seen',acceptance:'2025 fixed and monthly chronological multiclass Log Loss and Brier improve; fixed baseline-favorite60 subset binary Log Loss and Brier improve; inspect draw and league regressions; no automatic promotion',criteria:'Unchanged 60/70%, sample12, quote>=1.25 age<6h, conservative EV>=3%, max3/day one/game. No historical odds or ROI inferred.',limits:['Historical event-time reconstruction, not verified historical data availability.','2025/2026 were inspected before this study; not a new blind holdout.','Not the full contextual production v3; no settled v3 games available.','Calibration changes only 1X2 in this experiment; joint coherence with goal markets would require separate validation before integration.'],reference:'https://proceedings.mlr.press/v70/guo17a.html'};
fs.mkdirSync('work/research-calibration',{recursive:true});
fs.writeFileSync('work/research-calibration/protocol-'+Date.now()+'.json',JSON.stringify(protocol,null,2),{flag:'wx'});
const cutoff=Math.min(...rows(2025).map(r=>r.ts)),fit=fitCalibration(rows(2024),cutoff);
const evaluation={};
for(const year of [2024,2025,2026]){
 const valid=rows(year).filter(r=>r.sample>=12),favorites=valid.filter(r=>Math.max(r.probabilities.H,r.probabilities.A)>=.6);
 evaluation[year]={all:{baseline:scores(valid),calibrated:scores(valid,fit.alpha),paired:pairedInterval(valid,fit.alpha)},fixedFavorite60:{baseline:scores(favorites),calibrated:scores(favorites,fit.alpha),paired:pairedInterval(favorites,fit.alpha)},byLeague:Object.fromEntries([39,140,78,135,61].map(l=>{const r=valid.filter(r=>r.league===l);return [l,{baseline:scores(r),calibrated:scores(r,fit.alpha)}];})),correctedWinner60Count:valid.filter(r=>Math.max(...['H','A'].map(k=>calibrate(r.probabilities,fit.alpha)[k]))>=.6).length};
}
const months=[...new Set(rows(2025).map(r=>new Date(r.ts).toISOString().slice(0,7)))].sort(),monthly=[],rollingRows=[],rollingAlphas=[];
for(const month of months){
 const before=Date.parse(month+'-01T00:00:00Z'),past=[...rows(2024),...rows(2025)].filter(r=>r.ts+7200000<before),f=fitCalibration(past,before),targets=rows(2025).filter(r=>r.sample>=12&&new Date(r.ts).toISOString().startsWith(month));
 monthly.push({month,fit:f,baseline:scores(targets),calibrated:scores(targets,f.alpha)});rollingRows.push(...targets);rollingAlphas.push(...targets.map(()=>f.alpha));
}
const aggregate=key=>monthly.reduce((s,m)=>s+(m.calibrated[key]-m.baseline[key])*m.baseline.n,0)/rollingRows.length;
const a=evaluation[2025],gates={fixedLogLossImproves:a.all.calibrated.logLoss<a.all.baseline.logLoss,fixedBrierImproves:a.all.calibrated.brier<a.all.baseline.brier,favoriteLogLossImproves:a.fixedFavorite60.calibrated.favoriteLogLoss<a.fixedFavorite60.baseline.favoriteLogLoss,favoriteBrierImproves:a.fixedFavorite60.calibrated.favoriteBrier<a.fixedFavorite60.baseline.favoriteBrier,rollingLogLossImproves:aggregate('logLoss')<0,rollingBrierImproves:aggregate('brier')<0};
const report={protocol,fit,evaluation,monthly,rolling:{n:rollingRows.length,logLossDifference:aggregate('logLoss'),brierDifference:aggregate('brier'),paired:pairedInterval(rollingRows,rollingAlphas)},gates,allCoreGatesPassed:Object.values(gates).every(Boolean),productionChanged:false};
fs.writeFileSync('../../outputs/LuxTips-calibracao-favoritos.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({fit,gates,rolling:report.rolling,years:Object.fromEntries([2025,2026].map(y=>[y,{all:report.evaluation[y].all,favorites:report.evaluation[y].fixedFavorite60,correctedWinner60Count:report.evaluation[y].correctedWinner60Count}]))},null,2));
