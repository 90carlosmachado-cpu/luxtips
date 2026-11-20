import test from 'node:test';
import assert from 'node:assert/strict';
import {BIGODDS_POLICY,analyzeTicketExact} from '../bigodds-model.mjs';
import {optimizeBigOdds,selectRobustTicket} from '../bigodds-optimizer.mjs';
import {qualityLeg} from './bigodds-quality-fixtures.mjs';

const NOW=Date.parse('2026-11-20T08:00:00Z');
function leg(id,odd,probability=.85){
 const base=qualityLeg({id,home:2*id,away:2*id+1,league:39,ts:NOW+86400000},NOW);
 return {...base,odd,probability,probabilities:{O15:probability},
  modelProbability:probability,marketProbability:probability,
  modelProbabilities:{O15:probability}};
}

test('two selections at exactly total odd 2 survive policy JSON round-trip',()=>{
 const policy=JSON.parse(JSON.stringify(BIGODDS_POLICY));
 const result=optimizeBigOdds([leg(1,1.25),leg(2,1.6)],{...policy,now:NOW});
 assert.equal(result.status,'optimal');assert.equal(result.ticket.legs.length,2);
 assert.equal(result.ticket.odd,2);
 const stored=JSON.parse(JSON.stringify(result));
 assert.equal(stored.policy.maxOdd,null);assert.equal(stored.policy.maxLegs,null);
 assert.equal(stored.policy.minOdd,2);assert.equal(stored.policy.minLegs,2);
 assert.equal(stored.ticket.odd,2);
});

test('a single high-odd selection and a pair below odd 2 remain ineligible',()=>{
 assert.equal(analyzeTicketExact([leg(1,3)],NOW).ticket,null);
 const pair=analyzeTicketExact([leg(1,1.25),leg(2,1.599999)],NOW);
 assert.equal(pair.fixtureCount,2);assert.equal(pair.ticket,null);
 assert.equal(analyzeTicketExact([leg(1,1.25),leg(2,1.5999999999997)],NOW).ticket,null);
});

test('runtime accepts total odds above 15 when every quality criterion passes',()=>{
 const result=analyzeTicketExact([leg(1,4),leg(2,4)],NOW);
 assert.equal(result.status,'optimal');assert.equal(result.ticket.odd,16);
 assert.equal(result.ticket.legs.length,2);assert.ok(result.ticket.probability>=.20);
});

test('unbounded and finite maxima above 12 permit a 13-selection search',()=>{
 const candidates=Array.from({length:13},(_,i)=>leg(i+1,1.2,.98));
 for(const maxLegs of [null,13,14]){
  const result=optimizeBigOdds(candidates,{...BIGODDS_POLICY,minLegs:13,maxLegs,now:NOW});
  assert.equal(result.status,'optimal');assert.equal(result.ticket.legs.length,13);
  assert.ok(result.ticket.odd>=2);assert.ok(result.ticket.probability>=.20);
  assert.equal(result.policy.maxLegs,maxLegs);
 }
});

test('eligible games remain included after the minimum count and odd have been reached',()=>{
 const result=analyzeTicketExact([leg(1,1.25,.90),leg(2,1.6,.90),leg(3,4,.80),leg(4,4,.80)],NOW);
 assert.equal(result.status,'optimal');
 assert.deepEqual(result.ticket.legs.map(l=>l.fixtureId).sort((a,b)=>a-b),[1,2,3,4]);
 assert.equal(result.ticket.odd,32);assert.ok(Math.abs(result.ticket.probability-.5184)<1e-12);
 assert.equal(result.ticket.optimization.objective,'max_legs_then_probability');
});

test('the Lorient candidate joins all four eligible games in the 20 November replay scenario',()=>{
 const candidates=[leg(1,1.32,.7648985695858255),leg(2,1.23,.8407485491905414),
  leg(3,1.30,.772015837128614),leg(4,1.24,.8212887669488991)];
 const result=analyzeTicketExact(candidates,NOW);
 assert.equal(result.status,'optimal');assert.equal(result.ticket.legs.length,4);
 assert.ok(Math.abs(result.ticket.odd-2.6172432)<1e-12);
 assert.ok(Math.abs(result.ticket.probability-.40774821427905583)<1e-12);
 const legacyObjective=optimizeBigOdds(candidates,{...BIGODDS_POLICY,objective:'max_probability',now:NOW});
 assert.equal(legacyObjective.ticket.legs.length,3);
 assert.ok(Math.abs(legacyObjective.ticket.odd-2.013264)<1e-12);
});

test('probability breaks equal-count choices and the joint floor still prevents overfilling',()=>{
 const candidates=Array.from({length:8},(_,i)=>leg(i+1,1.3,i===7?.79:.80));
 const result=analyzeTicketExact(candidates,NOW);
 assert.equal(result.status,'optimal');assert.equal(result.ticket.legs.length,7);
 assert.deepEqual(result.ticket.legs.map(l=>l.fixtureId).sort((a,b)=>a-b),[1,2,3,4,5,6,7]);
 assert.ok(Math.abs(result.ticket.probability-.8**7)<1e-12);
 assert.ok(candidates.reduce((p,l)=>p*l.probability,1)<.20);
});

test('the standalone default retains the historical maximum-probability objective',()=>{
 const candidates=[leg(1,1.25,.90),leg(2,1.6,.90),leg(3,4,.80),leg(4,4,.80)];
 const result=optimizeBigOdds(candidates,{now:NOW,minLegs:2,maxLegs:null,minOdd:2,maxOdd:null});
 assert.equal(result.policy.objective,'max_probability');assert.equal(result.ticket.legs.length,2);
 assert.equal(result.ticket.odd,2);
});

test('finite caps still constrain historical or explicitly bounded analyses',()=>{
 const candidates=[leg(1,1.3),leg(2,1.3),leg(3,1.3)];
 assert.equal(optimizeBigOdds(candidates,{...BIGODDS_POLICY,maxLegs:2,now:NOW}).ticket,null);
 assert.equal(optimizeBigOdds(candidates,{...BIGODDS_POLICY,maxOdd:2.1,now:NOW}).ticket,null);
 assert.equal(optimizeBigOdds([leg(1,4),leg(2,4)],{...BIGODDS_POLICY,maxOdd:15,now:NOW}).ticket,null);
});

test('invalid maxima are rejected rather than silently interpreted as unlimited',()=>{
 for(const maxLegs of [undefined,0,1,2.5,Infinity,NaN,Number.MAX_SAFE_INTEGER+1]){
  assert.throws(()=>optimizeBigOdds([],{...BIGODDS_POLICY,maxLegs,now:NOW}),/Invalid optimizer policy/);
 }
 for(const maxOdd of [undefined,0,1.99,Infinity,NaN]){
  assert.throws(()=>optimizeBigOdds([],{...BIGODDS_POLICY,maxOdd,now:NOW}),/Invalid optimizer policy/);
 }
 assert.throws(()=>optimizeBigOdds([],{...BIGODDS_POLICY,objective:'unknown',now:NOW}),/Invalid optimizer policy/);
});

test('unbounded odds never serialize an overflowing ticket and unfinished searches stay closed',()=>{
 const overflow=analyzeTicketExact([leg(1,Number.MAX_VALUE),leg(2,Number.MAX_VALUE)],NOW);
 assert.equal(overflow.ticket,null);
 assert.equal(selectRobustTicket([leg(1,1.25),leg(2,1.6)],{...BIGODDS_POLICY,maxNodes:1,now:NOW}),null);
});
