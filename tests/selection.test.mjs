import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {testDatabase} from './sqlite.mjs';
import {marketCandidates,publishMarketPicks} from '../src/context/selection.mjs';
import {selectionAssessment,contextPrediction} from '../src/context/model.mjs';
import {enrichPrediction} from '../src/openfoot/live.mjs';
import {fit2,predict2,applyPricing} from '../src/legacy-worker.mjs';
const now=Date.now(),DAY=86400000;
function game(id=1){return {fixture:{id,ts:now+3600000,home:id,away:id+100,homeName:'Casa',awayName:'Fora',status:'NS',finished:false},sourceUpdatedAt:now,
 prediction:{sample:20,cutoff:now,probabilities:{H:.4,D:.3,A:.3,U35:.8},risks:[],contextAdjustment:{uncertainty:{spread:{H:.25,D:.2,A:.2,U35:.01}}}},winnerTip:null,
 odds:{U35:{fixtureId:id,odd:1.4,at:now,observedAt:now,source:'API-Football',verifiedReceipt:true,market:'U35',selection:'U35',bookmaker:'B'}}};}
test('balanced fixture can publish an independently qualified goals market despite large 1X2 disagreement',()=>{
 const g=game();const candidates=marketCandidates(g,now);assert.equal(candidates.length,1);assert.equal(candidates[0].market,'U35');
 assert.equal(selectionAssessment({...g,displayTip:{market:'U35',probability:.8}},now).modelDisagreement,.01);
 assert.equal(applyPricing({...g,displayTip:{market:'U35',probability:.8}},now).displayTip.priceEligible,true);
});
test('independent markets still reject stale/future odds, low samples, low probability, negative EV and unverified handicaps',()=>{
 const cases=[g=>g.odds.U35.at=now-6*3600000,g=>g.odds.U35.at=now+1,g=>g.prediction.sample=11,g=>g.prediction.sample=NaN,g=>g.prediction.probabilities.U35=.69,g=>g.odds.U35.odd=1.25,
  g=>{g.odds={AAP15:{odd:5,at:now}};g.prediction.probabilities.AAP15=.9;}];
 for(const change of cases){const g=game();change(g);assert.deepEqual(marketCandidates(g,now),[]);}
});
test('three alternatives can publish on one day, one per fixture; reruns and concurrent slots cannot duplicate or exceed the cap',async()=>{
 const db=testDatabase();
 db.sql.exec('CREATE TABLE published_picks(day TEXT,fixture_id INTEGER,kickoff INTEGER,market TEXT,alternative INTEGER,published_at INTEGER,recorded_at INTEGER,recovered INTEGER,data TEXT,PRIMARY KEY(day,fixture_id));CREATE TABLE published_alternatives(day TEXT PRIMARY KEY,fixture_id INTEGER,kickoff INTEGER,market TEXT,published_at INTEGER,recorded_at INTEGER,data TEXT);');
 db.sql.exec(readFileSync(new URL('../migrations/0002_publication_archive.sql',import.meta.url),'utf8'));
 const games=[1,2,3,4].map(game);await publishMarketPicks(db,games,now);await publishMarketPicks(db,games,now);
 const rows=db.sql.prepare('SELECT * FROM openfoot_current_picks').all();assert.equal(rows.length,3);assert.equal(new Set(rows.map(r=>r.fixture_id)).size,3);assert.ok(rows.every(r=>r.alternative===1));
 assert.equal(db.sql.prepare('SELECT count(*) n FROM published_picks').get().n,0);assert.throws(()=>db.sql.exec('DELETE FROM openfoot_pick_revisions'),/immutable/);db.sql.close();
});
test('partial xG keeps a well-covered opponent and shrinks the sparse team rather than switching both off',()=>{
 const history=Array.from({length:30},(_,i)=>({id:i+1,league:39,ts:now-(i+1)*DAY*2,home:1,away:2,homeName:'A',awayName:'B',hg:1,ag:1,finished:true,status:'FT'}));
 history.push(...Array.from({length:6},(_,i)=>({id:100+i,league:39,ts:now-(i+1)*DAY*3,home:3,away:2,homeName:'C',awayName:'B',hg:1,ag:1,finished:true,status:'FT'})));
 const observations=history.map(f=>({fixtureId:f.id,league:39,kickoff:f.ts,observedAt:f.ts+DAY,result:{home:1,away:1},homeXg:2,awayXg:.2}));
 const f={id:999,league:39,ts:now+DAY,home:3,away:2,homeName:'C',awayName:'B',status:'NS',finished:false};
 const base=predict2(fit2(history,now),f),before=structuredClone(history);
 const p=enrichPrediction(history,observations,f,base,now);assert.equal(p.xgEnrichment.active,true);assert.equal(p.xgEnrichment.status,'partial');
 assert.equal(p.xgEnrichment.teams[0].weight,.25);assert.equal(p.xgEnrichment.teams[1].weight,.5);assert.deepEqual(history,before);
 assert.equal(enrichPrediction(history,observations.filter(o=>o.fixtureId<100),f,base,now).xgEnrichment.teams[0].weight,0);
 assert.equal(enrichPrediction(history,observations.map(o=>({...o,observedAt:now+1})),f,base,now).xgEnrichment.active,false);
});
test('uncertainty is derived for every modeled market from its own mixture components',()=>{
 const base={sample:20,risks:[],homeGoals:1.5,awayGoals:1.5,components:[{weight:.5,homeGoals:2,awayGoals:1},{weight:.5,homeGoals:1,awayGoals:2}]};
 const p=contextPrediction([],game().fixture,base,{},[],now),s=p.contextAdjustment.uncertainty.spread;
 assert.ok(s.H>.1);assert.ok(s.U35<1e-12);assert.ok(s.HU25>0);assert.ok(Number.isFinite(s.O05));
});
