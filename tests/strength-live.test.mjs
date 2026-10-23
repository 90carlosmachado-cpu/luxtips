import test from 'node:test';
import assert from 'node:assert/strict';
import {fit2,predict2} from '../src/legacy-worker.mjs';
import {fitStrength,fitLiveStrength,predictLiveStrength} from '../src/openfoot/strength.mjs';
import {enrichPrediction} from '../src/openfoot/live.mjs';
import {shadowPrediction,SHADOW_OPTIONS} from '../src/openfoot/shadow.mjs';
import {POLICY,assessMarket} from '../src/context/policy.mjs';
import {CONTEXT_VERSION} from '../src/context/model.mjs';
const now=Date.now(),day=86400000;
const history=Array.from({length:36},(_,i)=>({id:i+1,league:39,ts:now-(i+1)*5*day,home:i%2?1:2,away:i%2?2:1,hg:i%2?3:0,ag:i%2?0:2,status:'FT',finished:true,homeName:'H',awayName:'A'}));
const f={id:999,league:39,ts:now+day,home:1,away:2,homeName:'H',awayName:'A',status:'NS',finished:false};
const observations=history.map(x=>({fixtureId:x.id,league:39,kickoff:x.ts,observedAt:x.ts+day,homeXg:x.home===1?2.4:.6,awayXg:x.away===1?2.1:.4,result:{home:x.hg,away:x.ag}}));
test('live Elo uses the same prior, sample, xG ceiling and temporal mixture',()=>{
 const states=fitLiveStrength(history,now,39),base=predictLiveStrength(states,f),live=enrichPrediction(history,observations,f,base,now);
 const expected=shadowPrediction(history,observations,f,now,{...SHADOW_OPTIONS,prior:4,eloWeight:.2,adaptiveCoverage:true});
 assert.deepEqual(live.probabilities,expected.probabilities);assert.equal(live.sample,base.sample);assert.equal(live.xgEnrichment.eloWeight,.2);
 assert.equal(base.strengthAdjustment.prior,4);assert.equal(live.xgEnrichment.prior,4);assert.equal(live.xgEnrichment.weight,.5);
 assert.deepEqual(states.map(s=>[s.weight,s.state.opts.halfLife]),fit2(history,now).map(s=>[s.weight,s.state.opts.halfLife]));
 assert.equal(states.every(s=>s.state.opts.prior===4),true);
 assert.equal(live.xgEnrichment.teams.every(t=>t.weight<=.5),true);
});
test('the ten competitions retain their scope; no-xG fallback uses the same adjusted fit only in the five xG leagues',()=>{
 for(const league of [94,39,140,78,135,61,88,2,3,848]){
  const changed=[39,140,78,135,61].includes(league),states=fitLiveStrength(history,now,league);
  assert.equal(states.every(s=>s.state.opts.prior===(changed?4:8)),true);
  assert.equal(states.every(s=>s.state.opts.eloWeight===.2),true);
  if(!changed)assert.deepEqual(fitStrength(history,now,8,0),fit2(history,now));
 }
 const base=predictLiveStrength(fitLiveStrength(history,now,39),f),fallback=enrichPrediction(history,[],f,base,now);
 assert.equal(fallback.xgEnrichment.active,false);assert.deepEqual(fallback.probabilities,base.probabilities);
 assert.throws(()=>fitStrength(history,now,2),/unsupported/);
});
test('the new model has its own version and unchanged publication criteria',()=>{
 assert.equal(CONTEXT_VERSION,'luxtips-events-xg-elo020-live-v4');
 assert.deepEqual(POLICY,{minimumOdd:1.25,oddsMaxAge:21600000,minimumSample:12,minimumExpectedReturn:.03,maxGamesPerDay:3,waitMs:900000});
 const g={fixture:f,sourceUpdatedAt:now,prediction:{sample:20,cutoff:now,probabilities:{H:.7,D:.2,A:.1},contextAdjustment:{uncertainty:{spread:{H:.08}}}},odds:{H:{fixtureId:f.id,market:'H',selection:'H',source:'API-Football',verifiedReceipt:true,bookmaker:'Book',odd:1.5,at:now-1000,observedAt:now}}};
 assert.equal(assessMarket(g,'H',now).reason,'insufficient_expected_return');
 g.prediction.sample=11.99;assert.equal(assessMarket(g,'H',now).reason,'insufficient_effective_sample');
 assert.equal(predict2(fit2(history,now),f).sample,predictLiveStrength(fitLiveStrength(history,now,39),f).sample);
});

test('Elo strengthens the higher-rated team, preserves normalization and ignores future results',()=>{
 const plain=predict2(fitStrength(history,now,4),f);
 const active=predictLiveStrength(fitLiveStrength(history,now,39),f);
 assert.ok(active.probabilities.H>plain.probabilities.H);
 assert.ok(Math.abs(active.probabilities.H+active.probabilities.D+active.probabilities.A-1)<1e-12);
 const future={...history[0],id:99999,ts:now+day};
 assert.deepEqual(fitLiveStrength([...history,future],now,39),fitLiveStrength(history,now,39));
 assert.throws(()=>fitStrength(history,now,4,NaN),/unsupported_elo/);
});
test('xG Elo uses real results even when synthetic xG reverses every outcome',()=>{
 const reversed=observations.map(o=>({...o,homeXg:o.result.home?0:10,awayXg:o.result.away?0:10}));
 const opts={...SHADOW_OPTIONS,prior:4,eloWeight:.2,adaptiveCoverage:true,xgWeight:1};
 const result=shadowPrediction(history,reversed,f,now,opts);
 const zero=shadowPrediction(history,reversed,f,now,{...opts,eloWeight:0});
 const states=fitStrength(history,now,4,.2);
 const delta=Math.max(-1,Math.min(1,(states[0].state.teams[1].elo-states[0].state.teams[2].elo)/400));
 assert.ok(delta>0);
 assert.ok(result.probabilities.H>zero.probabilities.H);
 assert.deepEqual(result.controlledBaseline.probabilities,predict2(states,f).probabilities);
});
