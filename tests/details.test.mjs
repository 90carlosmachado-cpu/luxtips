import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeMatchDetails} from '../src/openfoot/details.mjs';
import {historyWithoutKnownRedCards,detailedPrediction} from '../src/context/details-model.mjs';
import {auditFields} from '../src/context/coverage.mjs';
import {fit2,predict2} from '../src/legacy-worker.mjs';
const sample=JSON.parse(readFileSync(new URL('./fixtures/openfoot-39.json',import.meta.url)));
const events=JSON.parse(readFileSync(new URL('./fixtures/openfoot-events-39.json',import.meta.url)));
const now=Date.parse('2026-10-22T14:00:00Z');
test('real shot map and incidents reconcile score progression without inventing minute ordering',()=>{
 const d=normalizeMatchDetails(sample.match,sample.xg,events,now);
 assert.deepEqual(d.timeline.goals,{home:4,away:2});
 assert.equal(Object.values(d.timeline.exposure).reduce((a,b)=>a+b,0),90);
 assert.equal(d.timeline.exposure.tied,49);
 assert.equal(d.timeline.redCards.length,0);
 assert.ok(d.timeline.ambiguousMinuteShots>=0);
 assert.ok(Math.abs(d.shotProfiles.home.nonPenaltyXg+d.shotProfiles.home.penaltyXg-d.homeXg)<.02);
});
test('score mismatch, absent incident coverage and ambiguous decisive types fail closed',()=>{
 const wrong=structuredClone(events);wrong.data.events=wrong.data.events.filter(e=>e.type!=='goal');
 assert.throws(()=>normalizeMatchDetails(sample.match,sample.xg,wrong,now),{code:'event_score_mismatch'});
 assert.throws(()=>normalizeMatchDetails(sample.match,sample.xg,{...events,data:{...events.data,events:[]}},now),{code:'invalid_event_contract'});
 const red=structuredClone(events);red.data.events.push({id:'new',type:'unknown_red',minute:60,teamId:sample.match.homeTeam.id});
 assert.throws(()=>normalizeMatchDetails(sample.match,sample.xg,red,now),{code:'ambiguous_card_event'});
});
test('known red-card games are excluded; unknown and future observations are not treated as known cards',()=>{
 const e=structuredClone(events);e.data.events.push({id:'red',type:'red_card',minute:60,teamId:sample.match.homeTeam.id,player:'P'});
 const f={id:1,league:39,ts:Date.parse(sample.match.kickoffAt),hg:4,ag:2,finished:true,home:10,away:20};
 const d={...normalizeMatchDetails(sample.match,sample.xg,e,now),fixtureId:1,league:39,kickoff:f.ts};
 assert.deepEqual(historyWithoutKnownRedCards([f],[d],now),[]);
 assert.deepEqual(historyWithoutKnownRedCards([f],[{...d,observedAt:now+1}],now),[f]);
 assert.deepEqual(historyWithoutKnownRedCards([f],[],now),[f]);
 const base={xgEnrichment:{active:true}},p=detailedPrediction([f],[d],{...f,id:2,ts:now+86400000,finished:false},base,now);
 assert.equal(p.matchDetailsEnrichment.active,false);
});
test('coverage audit never relabels ordinary xG, saves, possession or passes as advanced metrics',()=>{
 const a=auditFields('statistics',[{statistics:[{type:'expected_goals',value:'1.8'},{type:'Goalkeeper Saves',value:4},{type:'Ball Possession',value:'60%'},{type:'Total passes',value:500},{type:'PSxG',value:null}]}]);
 assert.deepEqual(a.direct,{pressure:[],progression:[],postShotQuality:[]});
 assert.ok(a.possibleProxies.includes('Goalkeeper Saves'));
 const b=auditFields('statistics',[{statistics:[{type:'Progressive passes',value:34},{type:'PSxG',value:'1.7'},{type:'Pressures',value:120}]}]);
 assert.deepEqual(b.direct.pressure,['Pressures']);assert.deepEqual(b.direct.progression,['Progressive passes']);assert.deepEqual(b.direct.postShotQuality,['PSxG']);
});
test('adequate complete details activate separate non-penalty fits while preserving probability coherence',()=>{
 const normalized=normalizeMatchDetails(sample.match,sample.xg,events,now),day=86400000;
 const history=Array.from({length:50},(_,i)=>({id:i+1,league:39,ts:now-(i+1)*2*day,hg:4,ag:2,home:1,away:2,homeName:'H',awayName:'A',finished:true,status:'FT'}));
 const details=history.map(f=>({...normalized,fixtureId:f.id,league:39,kickoff:f.ts,observedAt:now-1000}));
 const fixture={id:999,league:39,ts:now+day,home:1,away:2,homeName:'H',awayName:'A',finished:false,status:'NS'};
 const base={...predict2(fit2(history,now),fixture),xgEnrichment:{active:true}},before=structuredClone(base);
 const p=detailedPrediction(history,details,fixture,base,now);
 assert.equal(p.matchDetailsEnrichment.active,true);assert.equal(p.matchDetailsEnrichment.nonPenalty,true);
 assert.ok(p.matchDetailsEnrichment.setPieces.home>0);assert.ok(p.matchDetailsEnrichment.weight>0&&p.matchDetailsEnrichment.weight<=.35);
 assert.ok(Math.abs(p.probabilities.H+p.probabilities.D+p.probabilities.A-1)<1e-12);
 assert.notEqual(p.homeGoals,base.homeGoals);assert.deepEqual(base,before);
});
