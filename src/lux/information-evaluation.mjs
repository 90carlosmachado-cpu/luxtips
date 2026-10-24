import {INFORMATION_CONTRACT} from './information-snapshot.mjs';
import {INFORMATION_POLICIES} from './information-policy.mjs';
import {informationPreview} from './information-preview.mjs';
export const INFORMATION_EXPERIMENT='information-asymmetric6-prospective-v1';
const keys=['H','D','A'],DAY=86400000;
const distribution=p=>p&&keys.every(k=>Number.isFinite(p[k])&&p[k]>=0&&p[k]<=1)&&Math.abs(keys.reduce((s,k)=>s+p[k],0)-1)<1e-8;
export async function captureDigest(snapshot){const body=structuredClone(snapshot);delete body.digest;const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(body)));return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');}
const identity=(a,b)=>a&&b&&['id','league','ts','home','away'].every(k=>a[k]===b[k]);
export async function validateInformationCapture(row,version){
 const g=row?.data,wrapper=g?.evaluation?.informationComparison,s=wrapper?.snapshot;
 const bad=reason=>({valid:false,reason});
 if(wrapper?.experiment!==INFORMATION_EXPERIMENT||wrapper.status!=='recorded'||s?.contract!==INFORMATION_CONTRACT||s.policyId!=='asymmetric6')return bad('missing_or_wrong_experiment');
 if(s.modelVersion!==version||g.prediction?.version!==version)return bad('wrong_model_version');
 if(!identity(s.fixture,g.fixture)||![39,140,78,135,61].includes(s.fixture?.league)||!Number.isSafeInteger(s.fixture?.id)||!Number.isFinite(s.fixture?.ts)||s.fixture.finished||s.fixture.status!=='NS')return bad('invalid_fixture');
 if(!Number.isFinite(row.createdAt)||row.createdAt!==s.recordedAt||s.recordedAt!==g.evaluation?.recordedAt||!Number.isFinite(s.cutoff)||s.cutoff!==g.prediction.cutoff||s.cutoff>s.recordedAt||s.recordedAt>=s.fixture.ts)return bad('invalid_capture_clock');
 if(s.recordedAt<s.fixture.ts-DAY)return bad('outside_final24h');
 if(!['fixture','history','context','detail','xg'].every(k=>Number.isFinite(s.sourceClocks?.[k])&&s.sourceClocks[k]<=s.cutoff&&s.sourceClocks[k]===g.evaluation?.clocks?.[k]))return bad('invalid_source_clock');
 if(!distribution(s.probabilities)||!distribution(g.prediction?.probabilities)||keys.some(k=>Math.abs(s.probabilities[k]-g.prediction.probabilities[k])>1e-12)||s.legacySample!==g.prediction.sample)return bad('invalid_prediction');
 if(s.originalCapture?.contract!=='prospective-inputs-v1'||!/^[a-f0-9]{64}$/.test(s.originalCapture.inputHash??'')||s.originalCapture.inputHash!==g.evaluation?.inputHash||g.evaluation?.validAtCapture!==true||g.evaluation.cutoff!==s.cutoff||!Number.isFinite(s.originalCapture.recordedAt)||s.originalCapture.recordedAt>s.recordedAt||s.originalCapture.recordedAt<s.cutoff)return bad('invalid_original_capture');
 if(!/^[0-9a-f]{64}$/.test(s.digest??'')||await captureDigest(s)!==s.digest)return bad('invalid_digest');
 const input={fixture:s.fixture,prediction:{cutoff:s.cutoff,probabilities:s.probabilities,sample:s.legacySample,contextAdjustment:{uncertainty:{spread:s.modelDisagreement}}},sourceUpdatedAt:s.sourceClocks.fixture,
  evidence:s.evidence,leagueAgeDays:s.leagueAgeDays,sampleMatches:true,odds:s.odds,oddsStatus:s.oddsStatus};
 const baseline=informationPreview(input,INFORMATION_POLICIES[0],s.recordedAt),candidate=informationPreview(input,INFORMATION_POLICIES.find(p=>p.id===s.policyId),s.recordedAt);
 if(JSON.stringify(baseline)!==JSON.stringify(s.baseline)||JSON.stringify(candidate)!==JSON.stringify(s.candidate))return bad('inconsistent_decisions');
 return {valid:true,snapshot:s};
}
function score(rows,probability=r=>r.probability){
 if(!rows.length)return {n:0,hits:0,accuracy:null,brier:null,logLoss:null,meanProbability:null,calibration:[]};
 const bins=Array.from({length:10},(_,i)=>({low:i/10,n:0,hits:0,p:0}));let hits=0,brier=0,ll=0,sum=0;
 for(const r of rows){const p=probability(r),q=Math.max(1e-15,Math.min(1-1e-15,p));hits+=r.hit;brier+=(p-r.hit)**2;ll-=r.hit*Math.log(q)+(1-r.hit)*Math.log(1-q);sum+=p;const b=bins[Math.min(9,Math.floor(p*10))];b.n++;b.hits+=r.hit;b.p+=p;}
 return {n:rows.length,hits,accuracy:hits/rows.length,brier:brier/rows.length,logLoss:ll/rows.length,meanProbability:sum/rows.length,
  calibration:bins.filter(b=>b.n).map(b=>({low:b.low,n:b.n,meanProbability:b.p/b.n,observedFrequency:b.hits/b.n}))};
}
function marketProbability(s,side){const m=s.marketReference;return m?.status==='available'&&Number.isSafeInteger(m.books)&&m.books>0&&distribution(m.probabilities)&&Number.isFinite(m.at)&&Number.isFinite(m.observedAt)&&m.at<=m.observedAt&&m.observedAt<=s.cutoff&&s.cutoff-m.at<6*3600000?m.probabilities[side]:null;}
function summary(rows,total,withReturn=false){const paired=rows.filter(r=>r.marketProbability!==null),priced=withReturn?rows.filter(r=>Number.isFinite(r.odd)):[];const net=priced.reduce((s,r)=>s+(r.hit?r.odd-1:-1),0);
 return {...score(rows),coverage:total?rows.length/total:0,marketComparison:{n:paired.length,model:score(paired),market:score(paired,r=>r.marketProbability)},
  theoreticalReturn:{n:priced.length,netUnits:priced.length?net:null,returnPerUnit:priced.length?net/priced.length:null,executedBets:null,kind:withReturn?'one-unit-at-verified-capture-price; no daily publication cap or execution costs':'not-computed-for-informational-candidates'}};
}
export async function evaluateInformationRows(rows,version,{now=Date.now()}={}){
 if(!Number.isFinite(now))throw Error('invalid_evaluation_clock');
 const excluded={},count=k=>excluded[k]=(excluded[k]||0)+1,seen=new Set(),pricedSeen=new Set(),all=[],priced=[];
 const ordered=[...rows].sort((a,b)=>(Number.isFinite(a.createdAt)?a.createdAt:Infinity)-(Number.isFinite(b.createdAt)?b.createdAt:Infinity));
 for(const row of ordered){let check;try{check=await validateInformationCapture(row,version);}catch{count('malformed_snapshot');continue;}
  if(!check.valid){count(check.reason);continue;}const s=check.snapshot,c=row.current;
  if(!identity(s.fixture,c)){count('settlement_identity_mismatch');continue;}
  if(!c.finished||c.status!=='FT'||!Number.isInteger(c.hg)||!Number.isInteger(c.ag)||c.hg<0||c.ag<0){count('unsettled_or_nonregulation');continue;}
  if(s.fixture.ts>=now){count('settlement_before_kickoff');continue;}
  const key=[s.fixture.id,s.fixture.ts,s.modelVersion,INFORMATION_EXPERIMENT].join(':'),informationNew=!seen.has(key),priceNew=s.candidate.priceState==='ready'&&!pricedSeen.has(key);
  if(!informationNew&&!priceNew){count('later_duplicate');continue;}
  const side=s.probabilities.H>=s.probabilities.A?'H':'A',probability=s.probabilities[side],hit=Number(side==='H'?c.hg>c.ag:c.ag>c.hg);
  const observation={fixtureId:s.fixture.id,league:s.fixture.league,recordedAt:s.recordedAt,probability,hit,distribution:s.probabilities,resultClass:c.hg>c.ag?'H':c.hg===c.ag?'D':'A',marketProbability:marketProbability(s,side),
   baselineInformation:probability>=.6&&s.baseline.information.eligible,candidateInformation:probability>=.6&&s.candidate.information.eligible,
   baselinePrice:s.baseline.counterfactualRulesPass,candidatePrice:s.candidate.counterfactualRulesPass,
   odd:s.candidate.priceState==='ready'?s.candidate.odd:null};
  if(informationNew){seen.add(key);all.push(observation);}if(priceNew){pricedSeen.add(key);priced.push(observation);}
 }
 const groups=(data,prices)=>({baseline:{information:summary(data.filter(r=>r.baselineInformation),data.length),priceEligible:summary(prices.filter(r=>r.baselinePrice),data.length,true)},
  candidate:{information:summary(data.filter(r=>r.candidateInformation),data.length),priceEligible:summary(prices.filter(r=>r.candidatePrice),data.length,true)},
  recovered:{information:summary(data.filter(r=>r.candidateInformation&&!r.baselineInformation),data.length),priceEligible:summary(prices.filter(r=>r.candidatePrice&&!r.baselinePrice),data.length,true)}});
 return {experiment:INFORMATION_EXPERIMENT,modelVersion:version,evaluatedAt:now,settledFixtures:all.length,priceCaptureFixtures:priced.length,
  allForecasts:{n:all.length,logLoss1X2:all.length?all.reduce((sum,r)=>sum-Math.log(Math.max(1e-15,r.distribution[r.resultClass])),0)/all.length:null,brier1X2:all.length?all.reduce((sum,r)=>sum+keys.reduce((s,k)=>s+(r.distribution[k]-Number(k===r.resultClass))**2,0),0)/all.length:null},
  ...groups(all,priced),byLeague:Object.fromEntries([...new Set(all.map(r=>r.league))].map(l=>[l,groups(all.filter(r=>r.league===l),priced.filter(r=>r.league===l))])),excluded,
  scored:all.map(({fixtureId,recordedAt,probability,hit,baselineInformation,candidateInformation,baselinePrice,candidatePrice})=>({fixtureId,recordedAt,probability,hit,baselineInformation,candidateInformation,baselinePrice,candidatePrice})),
  pricedScored:priced.map(({fixtureId,recordedAt,probability,hit,baselinePrice,candidatePrice})=>({fixtureId,recordedAt,probability,hit,baselinePrice,candidatePrice})),
  notes:['First valid forecast and separately first valid-price capture in final24h per fixture/kickoff/model version; digest and decisions checked before scoring.','The price capture is fixed by quote readiness, not by a positive EV, a winning result or a higher probability.','Selection metrics use binary victory Brier/log loss; allForecasts has three-class scores on the identical underlying model.','Information candidates and price-eligible counterfactuals are separate; no published-pick or executed-bet claims.','Market reference is paired on identical observations and must have been recorded before cutoff.']};
}
