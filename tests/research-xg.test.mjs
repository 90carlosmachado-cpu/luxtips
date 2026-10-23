import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareInputs,project,summarize,VARIANTS} from '../scripts/research-xg.mjs';
import {shadowPrediction} from '../src/openfoot/shadow.mjs';
const day=86400000,target={id:100,league:39,season:2026,ts:30*day,home:1,away:2,hg:9,ag:9,status:'FT',finished:true};
const history=Array.from({length:24},(_,i)=>({id:i,league:39,ts:(i+1)*day,home:i%2?1:2,away:i%2?2:1,hg:i%3,ag:i%2,status:'FT',finished:true,updatedAt:(i+2)*day}));
const observations=history.map(f=>({fixtureId:f.id,league:f.league,kickoff:f.ts,homeXg:1.4,awayXg:.8,result:{home:f.hg,away:f.ag},observedAt:f.ts+3*3600000}));
test('historical replay never passes target outcomes or unfinished/future/wrong-league matches to its model',()=>{
 const a=prepareInputs([...history,target,{...history[0],id:999,league:61},{...history[1],id:998,finished:false}],observations,target,'event-time-exploratory');
 assert.equal(a.history.length,24);assert.equal('hg' in a.fixture,false);assert.equal('ag' in a.fixture,false);assert.equal(a.fixture.status,'NS');
 const b=prepareInputs(history,observations,{...target,hg:0,ag:7},'event-time-exploratory');
 assert.deepEqual(project(a,VARIANTS[2]),project(b,VARIANTS[2]));
});
test('strict replay rejects sources imported after cutoff and preserves actual observation clocks',()=>{
 const future=observations.map(o=>({...o,observedAt:40*day}));
 assert.equal(prepareInputs(history,future,target).xg.size,0);
 assert.equal(prepareInputs(history,future,target,'event-time-exploratory').xg.size,24);
 assert.equal(future[0].observedAt,40*day);
 assert.equal(prepareInputs(history.map(f=>({...f,updatedAt:40*day})),observations,target).history.length,0);
});
test('xG reconciliation rejects score mismatches and does not replace missing xG by zero',()=>{
 const bad=observations.map(o=>({...o,result:{home:99,away:99}}));
 const input=prepareInputs(history,bad,target,'event-time-exploratory');assert.equal(input.xg.size,0);
 assert.deepEqual(project(input,VARIANTS[0]).probabilities,project(input,VARIANTS[2]).probabilities);
});
test('explicit current prior reproduces the existing fit; research prior changes do not mutate inputs',()=>{
 const input=prepareInputs(history,observations,target,'event-time-exploratory'),before=JSON.stringify(input.history);
 assert.deepEqual(project(input,VARIANTS[2]),project(input,{...VARIANTS[2],prior:8}));
 const candidate=project(input,{...VARIANTS[2],prior:4});assert.ok(Math.abs(candidate.probabilities.H+candidate.probabilities.D+candidate.probabilities.A-1)<1e-9);
 assert.equal(JSON.stringify(input.history),before);assert.equal(project(input,VARIANTS[2]).sample,candidate.sample);
});
test('teams without any usable xG retain the goals fallback even if other teams have xG',()=>{
 const input=prepareInputs(history,observations,{...target,home:99,away:98},'event-time-exploratory');
 assert.deepEqual(project(input,VARIANTS[0]).probabilities,project(input,VARIANTS[2]).probabilities);
});
test('research control exactly reproduces the prior8 historical adaptive xG calculation when active',()=>{
 const input=prepareInputs(history,observations,target);
 const expected=shadowPrediction(input.history,observations,input.fixture,input.cutoff,{xgWeight:.5,minimumMatches:12,minimumCoverage:.7,adaptiveCoverage:true});
 assert.equal(expected.status,'ready');assert.deepEqual(project(input,VARIANTS[2]).probabilities,expected.probabilities);
});
test('multiclass proper scores distinguish confidence from win rate and abstention thresholds remain descriptive',()=>{
 const rows=[{sample:10,hg:1,ag:0,probabilities:{H:.8,D:.1,A:.1},xgTeams:[.5,.5]}];
 const m=summarize(rows);assert.equal(m.all1X2.n,1);assert.ok(Math.abs(m.all1X2.brier-.06)<1e-10);assert.equal(m.winner60_sample12.n,0);assert.equal(m.winner60_sample8.n,1);
});
