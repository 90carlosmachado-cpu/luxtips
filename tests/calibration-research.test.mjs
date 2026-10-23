import test from 'node:test';
import assert from 'node:assert/strict';
import {calibrate,calibratedGame,fitCalibration,scores} from '../scripts/calibration-research.mjs';
import {assessMarket,POLICY} from '../src/context/policy.mjs';
test('temperature identity, normalized distribution and ranking are preserved without mutating input',()=>{
 const p={H:.65,D:.22,A:.13},before=JSON.stringify(p);
 assert.deepEqual(calibrate(p,1),p);
 for(const alpha of [.5,1.07,2]){const q=calibrate(p,alpha);assert(Math.abs(q.H+q.D+q.A-1)<1e-12);assert(q.H>q.D&&q.D>q.A);}
 assert.equal(JSON.stringify(p),before);assert(calibrate(p,1.07).H>p.H);
});
test('invalid coefficients and distributions are rejected',()=>{
 for(const a of [.49,2.01,NaN])assert.throws(()=>calibrate({H:.6,D:.2,A:.2},a));
 for(const p of [{H:.6,D:.2,A:.3},{H:0,D:.5,A:.5},{H:NaN,D:.3,A:.7}])assert.throws(()=>calibrate(p));
});
const training=Array.from({length:300},(_,i)=>({ts:0,sample:20,hg:i%10<8?1:0,ag:i%10===9?1:0,probabilities:{H:.6,D:.2,A:.2}}));
test('fit uses only completed past matches and never target or future outcomes',()=>{
 const before=86400000,base=fitCalibration(training,before),future=training.map(r=>({...r,ts:before,hg:0,ag:99}));
 assert(base.alpha>1);assert.deepEqual(fitCalibration([...training,...future],before),base);
 assert.deepEqual(fitCalibration([...training,...future.map(r=>({...r,hg:99,ag:0}))],before),base);
 assert(base.maxTrainingKickoff+7200000<before);
});
test('small or insufficient effective calibration samples keep the identity',()=>{
 assert.equal(fitCalibration(training.slice(0,199),86400000).alpha,1);
 assert.equal(fitCalibration(training.map(r=>({...r,sample:11.9})),86400000).alpha,1);
});
test('scores penalize incorrect confidence on the same fixtures',()=>{
 const r=[{sample:20,ts:0,hg:0,ag:1,probabilities:{H:.6,D:.2,A:.2}}];
 assert(scores(r,2).logLoss>scores(r,1).logLoss);assert(scores(r,2).brier>scores(r,1).brier);
});
test('prospective calibration preserves source clocks, odds, sample and never lowers divergence',()=>{
 const now=100000000,quote={odd:1.3,bookmaker:'House',at:now-1000,observedAt:now-100,source:'API-Football',verifiedReceipt:true,selection:'H',market:'H',fixtureId:1},g={fixture:{id:1,ts:now+86400000,status:'NS',finished:false},sourceUpdatedAt:now-1000,prediction:{cutoff:now-100,sample:20,probabilities:{H:.6,D:.2,A:.2},components:[{homeGoals:2,awayGoals:1},{homeGoals:1.8,awayGoals:1.1}],contextAdjustment:{uncertainty:{spread:{H:.1,D:.1,A:.1}}}},odds:{H:quote}};
 const before=JSON.stringify(g),c=calibratedGame(g,1.07);
 assert.equal(JSON.stringify(g),before);assert.deepEqual(c.odds,g.odds);assert.equal(c.prediction.sample,20);assert.equal(c.sourceUpdatedAt,g.sourceUpdatedAt);
 for(const m of ['H','D','A'])assert(c.prediction.contextAdjustment.uncertainty.spread[m]>=g.prediction.contextAdjustment.uncertainty.spread[m]);
 assert.equal(assessMarket(c,'H',now).eligible,false);
 assert.equal(assessMarket({...c,prediction:{...c.prediction,sample:11}},'H',now).reason,'insufficient_effective_sample');
 assert.equal(assessMarket({...c,odds:{H:{...quote,at:now-6*3600000}}},'H',now).reason,'quote_expired');
 assert.equal(POLICY.minimumExpectedReturn,.03);assert.equal(POLICY.minimumSample,12);assert.equal(POLICY.minimumOdd,1.25);
});
