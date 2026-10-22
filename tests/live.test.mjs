import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichPrediction, liveEnvironment } from '../src/openfoot/live.mjs';
import { fit2, predict2 } from '../src/legacy-worker.mjs';
test('live model uses xG with adequate data and preserves the original prediction object', () => {
  const now = Date.now(), day = 86400000;
  const history = Array.from({length:30},(_,i)=>({ id:i+1,league:39,ts:now-(i+1)*5*day,home:1,away:2,homeName:'A',awayName:'B',hg:1,ag:1,finished:true,status:'FT' }));
  const observations = history.map(f=>({ fixtureId:f.id,league:39,kickoff:f.ts,observedAt:f.ts+day,result:{home:1,away:1},homeXg:3,awayXg:0.2 }));
  const fixture = {id:99,league:39,ts:now+day,home:1,away:2,homeName:'A',awayName:'B',finished:false,status:'NS'};
  const base = predict2(fit2(history,now),fixture), before=structuredClone(base);
  const live = enrichPrediction(history,observations,fixture,base,now);
  assert.equal(live.xgEnrichment.active,true);
  assert.equal(live.version,'openfoot-xg-live-v1');
  assert.ok(live.probabilities.H>base.probabilities.H);
  assert.deepEqual(base,before);
  assert.equal(enrichPrediction(history,[],fixture,base,now).xgEnrichment.active,false);
});
test('mode is explicit and unavailable xG falls back safely', async () => {
  const env={OPENFOOT_MODE:'shadow'};
  assert.equal(liveEnvironment(env),env);
  const live=liveEnvironment({OPENFOOT_MODE:'live',DB:{prepare(){throw new Error('unavailable');}}});
  const base={version:'old'};
  assert.deepEqual(await live.__openfootEnrich([],{league:94},base,Date.now()),base);
  assert.equal((await live.__openfootEnrich([],{league:39},base,Date.now())).xgEnrichment.status,'unavailable');
});
