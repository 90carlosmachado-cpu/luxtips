import {optimizeBigOdds} from './bigodds-optimizer.mjs';
// Research candidate goals4: role-specific goals, prior 4, half-life 180 days.
// No results from the target game and no market odds enter the probability model.
export const BIGODDS_POLICY=Object.freeze({id:'bigodds-exact-ev-betano-v4',optimizer:'exact-branch-bound-v1',minLegExpectedReturn:0,minTicketExpectedReturn:.03,disallowRepeatedTeams:true,maxNodes:1000000,bookmaker:'Betano',source:'xg90-prior2-market50',reuseWithdrawn:true,days:3,publicationHour:8,minLegs:5,maxLegs:12,minOdd:8,maxOdd:15,minLegOdd:1.2,minProbability:.5,quoteMaxAge:21600000,prior:2,halfLifeDays:90,xgWeight:1,marketWeight:.5,minXgRoleWeighted:2,minXgLeagueWeighted:20,markets:['1','2','1X','X2','O15','O25','O35','BY','BN'],experimental:true});
const DAY=86400000,DECAY=180*DAY/Math.LN2;
export function goalModel(history,now){
 const leagues=new Map(),teams=new Map();
 const add=(map,key,w,gf,ga)=>{const s=map.get(key)||[0,0,0,0];s[0]+=w;s[1]+=w*gf;s[2]+=w*ga;s[3]++;map.set(key,s);};
 for(const r of history){
  if(!Number.isInteger(r.hg)||!Number.isInteger(r.ag)||r.hg<0||r.ag<0||r.settled_at>now||r.kickoff+7200000>now)continue;
  const w=Math.exp(-(now-r.kickoff-7200000)/DECAY);
  add(leagues,r.league+':0',w,r.hg,r.ag);add(leagues,r.league+':1',w,r.ag,r.hg);
  add(teams,r.league+':'+r.home+':0',w,r.hg,r.ag);add(teams,r.league+':'+r.away+':1',w,r.ag,r.hg);
 }
 return f=>{
  const lh=leagues.get(f.league+':0')||[0,0,0,0],la=leagues.get(f.league+':1')||[0,0,0,0];
  const h=teams.get(f.league+':'+f.home+':0')||[0,0,0,0],a=teams.get(f.league+':'+f.away+':1')||[0,0,0,0];
  const bh=(lh[1]+30)/(lh[0]+20),ba=(la[1]+24)/(la[0]+20);
  const mh=bh*((h[1]+4*bh)/(h[0]+4)/bh)*((a[2]+4*bh)/(a[0]+4)/bh);
  const ma=ba*((a[1]+4*ba)/(a[0]+4)/ba)*((h[2]+4*ba)/(h[0]+4)/ba);
  return {probabilities:scoreProbabilities(mh,ma),homeGoals:mh,awayGoals:ma,homeSample:h[3],awaySample:a[3]};
 };
}
// The frozen no-unders research candidate. goalModel above remains a legacy
// reference for replay tests; new publications use xgMarketModel below.
export function xgMarketModel(history,now,details=[]){
 const leagues=new Map(),teams=new Map(),xl=new Map(),xt=new Map(),past=new Map();
 const decay=90*86400000/Math.LN2;
 const add=(map,key,w,gf,ga)=>{const v=map.get(key)||[0,0,0,0];v[0]+=w;v[1]+=w*gf;v[2]+=w*ga;v[3]++;map.set(key,v);};
 const valid=r=>Number.isInteger(r.id)&&Number.isInteger(r.home)&&Number.isInteger(r.away)&&Number.isInteger(r.hg)&&Number.isInteger(r.ag)&&r.hg>=0&&r.ag>=0&&Number.isFinite(r.settled_at)&&r.settled_at<=now&&r.kickoff+7200000<=now;
 for(const r of history){
  if(!valid(r))continue;
  const w=Math.exp(-(now-r.kickoff-7200000)/decay);past.set(r.id,r);
  add(leagues,r.league+':0',w,r.hg,r.ag);add(leagues,r.league+':1',w,r.ag,r.hg);add(teams,r.league+':'+r.home+':0',w,r.hg,r.ag);add(teams,r.league+':'+r.away+':1',w,r.ag,r.hg);
 }
 const seen=new Set();
 for(const row of [...details].sort((a,b)=>a.observed_at-b.observed_at)){
  const r=past.get(row.fixture_id);let d;try{d=typeof row.data==='string'?JSON.parse(row.data):row.data;}catch{continue;}
  if(!r||seen.has(r.id)||!d||row.kickoff!==r.kickoff||row.league!==r.league||d.fixtureId!==r.id||d.league!==r.league||d.kickoff!==r.kickoff||d.result?.home!==r.hg||d.result?.away!==r.ag||d.observedAt!==row.observed_at||!(row.observed_at>r.kickoff&&row.observed_at<=now)||![d.homeXg,d.awayXg].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=20))continue;
  const w=Math.exp(-(now-r.kickoff-7200000)/decay);seen.add(r.id);add(xl,r.league+':0',w,d.homeXg,d.awayXg);add(xl,r.league+':1',w,d.awayXg,d.homeXg);add(xt,r.league+':'+r.home+':0',w,d.homeXg,d.awayXg);add(xt,r.league+':'+r.away+':1',w,d.awayXg,d.homeXg);
 }
 return f=>{
  const zero=[0,0,0,0],lh=leagues.get(f.league+':0')||zero,la=leagues.get(f.league+':1')||zero,h=teams.get(f.league+':'+f.home+':0')||zero,a=teams.get(f.league+':'+f.away+':1')||zero;
  const bh=(lh[1]+30)/(lh[0]+20),ba=(la[1]+24)/(la[0]+20),prior=2;
  let mh=bh*((h[1]+prior*bh)/(h[0]+prior)/bh)*((a[2]+prior*bh)/(a[0]+prior)/bh),ma=ba*((a[1]+prior*ba)/(a[0]+prior)/ba)*((h[2]+prior*ba)/(h[0]+prior)/ba);
  const xlh=xl.get(f.league+':0')||zero,xla=xl.get(f.league+':1')||zero,xh=xt.get(f.league+':'+f.home+':0')||zero,xa=xt.get(f.league+':'+f.away+':1')||zero;
  let xgUsed=Math.min(xlh[0],xla[0])>=20&&Math.min(xh[0],xa[0])>=2;
  if(xgUsed){const bxh=xlh[1]/xlh[0],bxa=xla[1]/xla[0];xgUsed=Math.min(bxh,bxa)>0;if(xgUsed){mh=bh*((xh[1]+prior*bxh)/(xh[0]+prior)/bxh)*((xa[2]+prior*bxh)/(xa[0]+prior)/bxh);ma=ba*((xa[1]+prior*bxa)/(xa[0]+prior)/bxa)*((xh[2]+prior*bxa)/(xh[0]+prior)/bxa);}}
  return {probabilities:scoreProbabilities(mh,ma),homeGoals:mh,awayGoals:ma,homeSample:h[3],awaySample:a[3],xgUsed,xgHomeSample:xh[3],xgAwaySample:xa[3],xgHomeWeighted:xh[0],xgAwayWeighted:xa[0],xgLeagueWeighted:Math.min(xlh[0],xla[0]),source:xgUsed?'xg':'goals_fallback'};
 };
}
export function scoreProbabilities(homeGoals,awayGoals){
 const poisson=lambda=>{lambda=Math.max(.15,Math.min(4.5,lambda));const p=[Math.exp(-lambda)];for(let n=1;n<=20;n++)p.push(p[n-1]*lambda/n);return p;};
 const h=poisson(homeGoals),a=poisson(awayGoals),p={'1':0,'2':0,'1X':0,'X2':0,'1+O15':0,'2+O15':0,'1X+O15':0,'X2+O15':0,O15:0,U15:0,O25:0,U25:0,O35:0,U35:0,BY:0,BN:0};let mass=0;
 for(let i=0;i<h.length;i++)for(let j=0;j<a.length;j++){
  const v=h[i]*a[j];mass+=v;
  for(const key of Object.keys(p))if(marketHit(key,i,j))p[key]+=v;
 }
 for(const key of Object.keys(p))p[key]/=mass;
 return p;
}
export function marketHit(m,h,a){
 const conditions={'1':h>a,'2':a>h,'1X':h>=a,'X2':a>=h,'1+O15':h>a&&h+a>=2,'2+O15':a>h&&h+a>=2,'1X+O15':h>=a&&h+a>=2,'X2+O15':a>=h&&h+a>=2,O15:h+a>=2,U15:h+a<=1,O25:h+a>=3,U25:h+a<=2,O35:h+a>=4,U35:h+a<=3,BY:h>0&&a>0,BN:h===0||a===0};
 if(!Object.hasOwn(conditions,m))throw Error('unknown_bigodds_market');return conditions[m];
}
export const MARKET_LABELS={'1':'Casa vence','2':'Visitante vence','1X':'1X','X2':'X2','1+O15':'Casa vence + mais de 1,5','2+O15':'Visitante vence + mais de 1,5','1X+O15':'1X + mais de 1,5','X2+O15':'X2 + mais de 1,5',O15:'Mais de 1,5 golos',U15:'Menos de 1,5 golos',O25:'Mais de 2,5 golos',U25:'Menos de 2,5 golos',O35:'Mais de 3,5 golos',U35:'Menos de 3,5 golos',BY:'Ambas marcam',BN:'Ambas não marcam'};
const side=m=>['1','1X','1+O15','1X+O15'].includes(m)?'home':['2','X2','2+O15','X2+O15'].includes(m)?'away':null;
// Historical selector retained only for existing replay tests; runtime uses analyzeTicketExact.
export function selectTicket(candidates){
 const books=new Map();
 for(const l of candidates){
  if(!BIGODDS_POLICY.markets.includes(l.market))continue;
  const model=l.modelProbabilities||l.probabilities;
  const direction=model['1X']>=model.X2?'home':'away';
  // Pick the analytical direction BEFORE applying the minimum price.
  if(side(l.market)&&side(l.market)!==direction)continue;
  const p=l.probabilities[l.market];
  if(!(Number.isFinite(p)&&p>=.5&&Number.isFinite(l.odd)&&l.odd>=1.2)||l.estimated)continue;
  if(!books.has(l.bookmaker))books.set(l.bookmaker,new Map());const games=books.get(l.bookmaker),old=games.get(l.fixtureId);
  if(!old||p>old.probability||p===old.probability&&l.market<old.market)games.set(l.fixtureId,{...l,probability:p});
 }
 let best=null;
 for(const [bookmaker,games] of [...books].sort(([a],[b])=>a.localeCompare(b))){
  const legs=[...games.values()].sort((a,b)=>b.probability-a.probability||a.fixtureId-b.fixtureId||a.market.localeCompare(b.market));
  let odd=1,lp=0;
  for(let n=0;n<Math.min(12,legs.length);n++){
   odd*=legs[n].odd;lp+=Math.log(legs[n].probability);
   if(odd>15+1e-9)break;
   if(n+1>=5&&odd>=8&&(!best||lp>best.logProbability))best={bookmaker,odd,logProbability:lp,legs:legs.slice(0,n+1)};
  }
 }
 return best;
}

// Preserve analytical direction before checking prices; do not chase the opposite side.
export function analyzeTicketExact(candidates,now=Date.now()){
 if(!Array.isArray(candidates))throw new TypeError('Expected candidate array');
 let directionRejected=0;
 const eligible=candidates.filter(l=>{
  const marketSide=side(l?.market);
  if(!marketSide)return true;
  const model=l.modelProbabilities||l.probabilities;
  if(!Number.isFinite(model?.['1X'])||!Number.isFinite(model?.X2)){directionRejected++;return false;}
  const direction=model['1X']>=model.X2?'home':'away';
  if(marketSide!==direction){directionRejected++;return false;}
  return true;
 });
 const result=optimizeBigOdds(eligible,{...BIGODDS_POLICY,now});
 if(directionRejected)result.rejections.analytical_direction=directionRejected;
 if(result.status!=='optimal')result.ticket=null;
 if(result.ticket)result.ticket.optimization={algorithm:BIGODDS_POLICY.optimizer,optimalityProved:true,
  independentGamesAssumed:true,probabilityCalibrationValidated:false,nodes:result.nodes,
  candidateCount:result.candidateCount,fixtureCount:result.fixtureCount};
 return result;
}
export function selectTicketExact(candidates,now=Date.now()){
 return analyzeTicketExact(candidates,now).ticket;
}
