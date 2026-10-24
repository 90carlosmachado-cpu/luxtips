// Shared information diagnostics, used by passive production capture only.
// The separate research prediction engines are not activated by this module.
export const EVIDENCE_VERSION='luxtips-evidence-research-v1';
export const DAY=86400000;
const decay=(age,half)=>Math.exp(-Math.LN2*age/DAY/half);
const complete=f=>f.finished&&f.status==='FT'&&Number.isInteger(f.hg)&&Number.isInteger(f.ag)&&f.hg>=0&&f.ag>=0;
export function availableHistory(history,cutoff,{strict=true}={}){
 if(!Number.isFinite(cutoff))throw Error('invalid_cutoff');
 const seen=new Set();
 return history.filter(f=>{
  if(!complete(f)||!Number.isFinite(f.ts)||f.ts+2*3600000>=cutoff||f.ts<=cutoff-3*365*DAY||strict&&(!Number.isFinite(f.updatedAt)||f.updatedAt>cutoff))return false;
  if(seen.has(f.id))throw Error('duplicate_fixture');seen.add(f.id);return true;
 }).sort((a,b)=>a.ts-b.ts||a.id-b.id);
}
export function teamInformation(history,team,cutoff,componentWeights=[{half:180,weight:.23402670885449198},{half:365,weight:.765973291145508}],{allowExtendedFulltime=false}={}){
 if(componentWeights.some(c=>c.half<=0||c.weight<0)||Math.abs(componentWeights.reduce((s,c)=>s+c.weight,0)-1)>1e-9)throw Error('invalid_component_weights');
 // The live normalizer stores score.fulltime for AET/PEN as well. Opt-in is
 // only for faithfully recording that existing fit; research FT defaults stay.
 const accepted=f=>complete(f)||allowExtendedFulltime&&f.finished&&['AET','PEN'].includes(f.status)&&Number.isInteger(f.hg)&&Number.isInteger(f.ag)&&f.hg>=0&&f.ag>=0;
 const rows=history.filter(f=>accepted(f)&&f.ts+2*3600000<cutoff&&f.ts>cutoff-3*365*DAY&&(f.home===team||f.away===team));
 const components=componentWeights.map(c=>{const weights=rows.map(f=>decay(cutoff-f.ts,c.half)),sum=weights.reduce((s,w)=>s+w,0),squares=weights.reduce((s,w)=>s+w*w,0);return {...c,weightMass:sum,kishEffectiveN:squares?sum*sum/squares:0};});
 return {rawMatches:rows.length,statusCounts:Object.fromEntries([...new Set(rows.map(f=>f.status))].map(status=>[status,rows.filter(f=>f.status===status).length])),lastAt:rows.length?Math.max(...rows.map(f=>f.ts)):null,
  ageDays:rows.length?(cutoff-Math.max(...rows.map(f=>f.ts)))/DAY:null,
  blendedWeightMass:components.reduce((s,c)=>s+c.weight*c.weightMass,0),
  // ESS and weight mass answer different questions; neither is a win probability.
  components,missing:rows.length?[]:['team-history']};
}
export function incomingTeamStatus(history,fixture,team,cutoff){
 const rows=history.filter(f=>complete(f)&&f.league===fixture.league&&f.ts+2*3600000<cutoff);
 const previous=rows.filter(f=>f.season===fixture.season-1),teams=new Set(previous.flatMap(f=>[f.home,f.away]));
 const current=rows.filter(f=>f.season===fixture.season&&(f.home===team||f.away===team));
 // First appearance is not proof of promotion. Require a substantial previous
 // season, and report an inferred entrant rather than an invented division.
 const known=previous.length>=200&&teams.size>=16;
 return {status:!known?'unknown':teams.has(team)?'established':'incoming-inferred',currentMatches:current.length,
  lowerDivisionHistory:false,previousSeasonMatches:previous.length};
}
export function regulationObservation(fixture,detail,cutoff){
 if(!complete(fixture)||fixture.ts+7200000>=cutoff||!detail||detail.fixtureId!==fixture.id||detail.league!==fixture.league||detail.kickoff!==fixture.ts||detail.result?.home!==fixture.hg||detail.result?.away!==fixture.ag||!Number.isFinite(detail.observedAt)||detail.observedAt>cutoff||detail.observedAt<=fixture.ts+7200000||!detail.timeline?.complete)return null;
 const t=detail.timeline,cards=t.redCards;
 if(!Array.isArray(cards))return null;
 if(!cards.length)return {minutes:90,homeGoals:fixture.hg,awayGoals:fixture.ag,kind:'full-match'};
 const first=Math.min(...cards.map(c=>c.clock));
 if(!Number.isFinite(first)||first<=0||first>90)return null;
 const intervals=t.intervals;
 if(!Array.isArray(intervals)||intervals.some(i=>![i.from,i.to,i.homeGoals,i.awayGoals].every(Number.isFinite)))return null;
 // A goal on the same minute as a card cannot be ordered with minute data.
 if(first<90&&intervals.some(i=>i.from===first))return null;
 const before=intervals.find(i=>i.from<first&&i.to>=first);
 if(!before)return null;
 // At 90 the timeline does not distinguish late goals: retain only when the
 // score before the boundary already equals the verified final score.
 if(first===90&&(before.homeGoals!==fixture.hg||before.awayGoals!==fixture.ag))return null;
 return {minutes:first,homeGoals:before.homeGoals,awayGoals:before.awayGoals,kind:first===90?'full-regulation-before-late-red':'eleven-v-eleven-prefix'};
}
