import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {INFORMATION_POLICIES,assessInformation,chooseInformationPolicy} from '../src/lux/information-policy.mjs';
const root='work/information-policy';fs.mkdirSync(root,{recursive:true});
const features=JSON.parse(fs.readFileSync('work/lux-evidence/features.json'));
const source='work/model-comparison',files=fs.readdirSync(source),fixtures=files.filter(f=>/^fixtures-\d+\.json$/.test(f)).flatMap(f=>JSON.parse(fs.readFileSync(source+'/'+f)));
const protocol={createdAt:new Date().toISOString(),version:'information-policy-research-v1',inputHash:createHash('sha256').update(JSON.stringify({features,fixtures})).digest('hex'),
 policies:INFORMATION_POLICIES,probability:.6,recency:'newly admitted teams may lag the most recent league result by at most 45 days; league-wide breaks not penalized',
 selection:'Choose maximum development coverage among extensions with >=30 recovered candidates; recovered Wilson95 lower>0.5; accuracy >= baseline-0.02; probability-bin ECE <= baseline+0.02. Ties prefer earlier registered policy. Otherwise retain legacy12.',
 development:'season2024',confirmation:'season2025 before2026-01-01; fixed policy',evaluation:'season2025 from2026-01-01; fixed policy',audit:'season2026, already examined',
 success:'Confirmation AND evaluation: overall accuracy difference lower95>-0.05 and ECE <=baseline+0.02; recovered point accuracy>=0.60 and n>=30 in each period. Otherwise no recommendation to promote. Operational margins are research criteria, not proven universal thresholds.',
 bootstrap:'2000 paired draws of calendar weeks; seed918273; accuracy ratios recomputed; intervals conditional on selected policy',
 caps:'Both unrestricted candidates and static top3/day Europe/Lisbon, ordered by probability then kickoff then id. Not a replay of price-aware immutable live publication.',
 limitations:['Same previously inspected seasons, not untouched testing.','Event-time reconstruction excludes live detail/red-card/context effects and cannot prove source availability.','No adequate historical odds: no EV or ROI backtest; information eligibility does not mean a betting recommendation.','Entrants inferred from membership, not verified promotions.','This phase changes selection only; underlying probabilities stay frozen.']};
// Write the complete protocol before computing selection or scores.
fs.writeFileSync(root+'/protocol.json',JSON.stringify(protocol,null,2));
const lastByCutoff=new Map();
const rows=features.rows.map(r=>{
 const key=r.league+':'+r.cutoff;let last=lastByCutoff.get(key);
 if(last===undefined){last=Math.max(0,...fixtures.filter(f=>f[1]===r.league&&f[2]+7200000<r.cutoff&&f[2]>r.cutoff-3*365*86400000).map(f=>f[2]));lastByCutoff.set(key,last);}
 const input={probabilities:r.base,legacySample:r.sample,evidence:r.evidence,leagueAgeDays:last?(r.cutoff-last)/86400000:null};
 const side=r.base.H>=r.base.A?0:2,q=side===0?r.base.H:r.base.A;
 return {...r,q,side,hit:Number(side===r.y),input,admitted:Object.fromEntries(INFORMATION_POLICIES.map(p=>[p.id,q>=.6&&assessInformation(input,p).eligible]))};
});
export function wilson(hits,n){if(!n)return null;const z=1.959963984540054,p=hits/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,m=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;return {lower:c-m,upper:c+m};}
function metrics(selected,total){
 if(!selected.length)return {n:0,hits:0,accuracy:null,coverage:0,meanProbability:null,ece:null};
 const n=selected.length,hits=selected.reduce((s,r)=>s+r.hit,0),meanProbability=selected.reduce((s,r)=>s+r.q,0)/n;
 const bins=Array.from({length:4},(_,i)=>({low:.6+i*.1,n:0,hits:0,p:0}));let brier=0,ll=0;
 for(const r of selected){const b=bins[Math.min(3,Math.floor((r.q-.6+1e-10)*10))];b.n++;b.hits+=r.hit;b.p+=r.q;brier+=(r.q-r.hit)**2;const q=Math.min(1-1e-15,Math.max(1e-15,r.q));ll-=r.hit*Math.log(q)+(1-r.hit)*Math.log(1-q);}
 return {n,hits,accuracy:hits/n,coverage:n/total,meanProbability,calibrationGap:meanProbability-hits/n,wilson95:wilson(hits,n),binaryBrier:brier/n,binaryLogLoss:ll/n,
 ece:bins.reduce((s,b)=>s+Math.abs(b.p-b.hits),0)/n,bins:bins.filter(b=>b.n).map(b=>({low:b.low,n:b.n,meanProbability:b.p/b.n,accuracy:b.hits/b.n}))};
}
function cap(rows,id){const days=new Map();for(const r of rows.filter(r=>r.admitted[id])){const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Lisbon',year:'numeric',month:'2-digit',day:'2-digit'}).format(r.ts);if(!days.has(day))days.set(day,[]);days.get(day).push(r);}return [...days.values()].flatMap(g=>g.sort((a,b)=>b.q-a.q||a.ts-b.ts||a.id-b.id).slice(0,3));}
function compare(data,id){const selected=data.filter(r=>r.admitted[id]),base=data.filter(r=>r.admitted.legacy12),recovered=selected.filter(r=>!r.admitted.legacy12),capped=cap(data,id),baseCapped=cap(data,'legacy12'),ids=new Set(baseCapped.map(r=>r.id)),chosenIds=new Set(capped.map(r=>r.id));
 return {all:metrics(selected,data.length),recovered:metrics(recovered,data.length),
 incoming:metrics(selected.filter(r=>r.evidence.incoming.some(t=>t.status==='incoming-inferred')),data.length),
 incomingOpponent:metrics(selected.filter(r=>r.evidence.incoming[r.side===0?1:0].status==='incoming-inferred'),data.length),
 incomingFavorite:metrics(selected.filter(r=>r.evidence.incoming[r.side===0?0:1].status==='incoming-inferred'),data.length),
 capped:{...metrics(capped,data.length),added:capped.filter(r=>!ids.has(r.id)).length,displaced:baseCapped.filter(r=>!chosenIds.has(r.id)).length},baseN:base.length,
 byLeague:Object.fromEntries([39,140,78,135,61].map(l=>[l,metrics(selected.filter(r=>r.league===l),data.filter(r=>r.league===l).length)]))};}
const phases={development:rows.filter(r=>r.season===2024),confirmation:rows.filter(r=>r.season===2025&&r.ts<Date.UTC(2026,0,1)),evaluation:rows.filter(r=>r.season===2025&&r.ts>=Date.UTC(2026,0,1)),audit:rows.filter(r=>r.season===2026)};
const development=Object.fromEntries(INFORMATION_POLICIES.map(p=>[p.id,compare(phases.development,p.id)]));
const {chosen,eligible}=chooseInformationPolicy(development);
// Lock selection before computing any later-period metrics.
fs.writeFileSync(root+'/choice.json',JSON.stringify({chosen,development,eligible},null,2));
function bootstrap(data,id){
 const weeks=new Map();for(const r of data){const key=Math.floor((r.ts+3*86400000)/(7*86400000));if(!weeks.has(key))weeks.set(key,[]);weeks.get(key).push(r);}
 const groups=[...weeks.values()].map(g=>({bn:g.filter(r=>r.admitted.legacy12).length,bh:g.filter(r=>r.admitted.legacy12).reduce((s,r)=>s+r.hit,0),n:g.filter(r=>r.admitted[id]).length,h:g.filter(r=>r.admitted[id]).reduce((s,r)=>s+r.hit,0)}));
 let seed=918273;const differences=[];for(let i=0;i<2000;i++){let n=0,h=0,bn=0,bh=0;for(let j=0;j<groups.length;j++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const g=groups[Math.floor(seed/4294967296*groups.length)];n+=g.n;h+=g.h;bn+=g.bn;bh+=g.bh;}if(n&&bn)differences.push(h/n-bh/bn);}
 differences.sort((a,b)=>a-b);return {weeks:groups.length,iterations:differences.length,lower95:differences[Math.floor(.025*differences.length)],upper95:differences[Math.floor(.975*differences.length)]};
}
const results=Object.fromEntries(Object.entries(phases).map(([phase,data])=>[phase,{n:data.length,policies:Object.fromEntries(INFORMATION_POLICIES.map(p=>[p.id,compare(data,p.id)])),bootstrap:bootstrap(data,chosen)}]));
const criteria=Object.fromEntries(['confirmation','evaluation'].map(phase=>{const r=results[phase],c=r.policies[chosen],b=r.policies.legacy12;return [phase,{noninferiority:r.bootstrap.lower95>-.05,calibration:c.all.ece<=b.all.ece+.02,recoveredSample:c.recovered.n>=30,recoveredAccuracy:c.recovered.accuracy>=.6}];}));
const passed=chosen!=='legacy12'&&Object.values(criteria).every(c=>Object.values(c).every(Boolean));
const output={protocol,chosen,eligible,results,criteria,retrospectiveGatePassed:passed,
 decisions:rows.map(r=>({id:r.id,league:r.league,season:r.season,ts:r.ts,probability:r.q,legacySample:r.sample,hit:r.hit,admitted:r.admitted,evidence:r.evidence,leagueAgeDays:r.input.leagueAgeDays}))};
fs.writeFileSync(root+'/results.json',JSON.stringify(output,null,2));
console.log(JSON.stringify({chosen,eligible:output.eligible,criteria,retrospectiveGatePassed:passed,phases:Object.fromEntries(Object.entries(results).map(([p,r])=>[p,{n:r.n,baseline:r.policies.legacy12.all,candidate:r.policies[chosen].all,recovered:r.policies[chosen].recovered,bootstrap:r.bootstrap}]))}));
