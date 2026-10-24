import test from 'node:test';import assert from 'node:assert/strict';
import {INFORMATION_POLICIES,assessInformation,chooseInformationPolicy} from '../src/lux/information-policy.mjs';
import {informationPreview} from '../src/lux/information-preview.mjs';
import {informationSnapshot} from '../src/lux/information-snapshot.mjs';
import {teamInformation,DAY} from '../src/lux/evidence.mjs';
const policy=id=>INFORMATION_POLICIES.find(p=>p.id===id),strong={rawMatches:100,blendedWeightMass:50,ageDays:7},newcomer={rawMatches:6,blendedWeightMass:5,ageDays:7};
const input={probabilities:{H:.7,D:.2,A:.1},legacySample:5,evidence:{home:strong,away:newcomer},leagueAgeDays:1};
test('asymmetric information admits a known favourite against an opponent with six matches',()=>{
 const before=structuredClone(input);assert.equal(assessInformation(input,policy('legacy12')).eligible,false);
 assert.equal(assessInformation(input,policy('asymmetric6')).eligible,true);assert.equal(assessInformation(input,policy('balanced8')).eligible,false);assert.deepEqual(input,before);
 assert.equal(assessInformation({...input,probabilities:{H:.1,D:.2,A:.7}},policy('asymmetric6')).eligible,false);
});
test('sample extensions retain all previously admitted samples and reject corrupt distributions',()=>{
 for(const p of INFORMATION_POLICIES)assert.equal(assessInformation({...input,legacySample:12,evidence:null},p).eligible,true);
 assert.equal(assessInformation({...input,probabilities:{H:.7,D:.3,A:.2}},policy('asymmetric6')).eligible,false);
 assert.equal(assessInformation({...input,legacySample:NaN},policy('asymmetric6')).eligible,false);
 assert.throws(()=>assessInformation(input,{...policy('asymmetric6')}),/unregistered/);
});
test('summer breaks do not count as team-specific inactivity; additional team absence does',()=>{
 const summer={...input,leagueAgeDays:80,evidence:{home:{...strong,ageDays:81},away:{...newcomer,ageDays:82}}};
 assert.equal(assessInformation(summer,policy('asymmetric6')).eligible,true);
 assert.equal(assessInformation({...summer,evidence:{...summer.evidence,away:{...newcomer,ageDays:126}}},policy('asymmetric6')).reason,'team_inactive_relative_to_league');
 assert.equal(assessInformation({...input,leagueAgeDays:8},policy('asymmetric6')).reason,'invalid_league_clock');
});
test('unknown team history and fabricated mass cannot unlock a candidate',()=>{
 for(const away of [{...newcomer,rawMatches:0},{...newcomer,blendedWeightMass:10},{...newcomer,ageDays:null}])assert.equal(assessInformation({...input,evidence:{home:strong,away}},policy('asymmetric6')).eligible,false);
});
test('development choice falls back to baseline on insufficient recovered evidence',()=>{
 const statistics={all:{n:100,accuracy:.7,ece:.03},recovered:{n:20,wilson95:{lower:.6}}};
 const scores=Object.fromEntries(INFORMATION_POLICIES.map(p=>[p.id,structuredClone(statistics)]));
 assert.equal(chooseInformationPolicy(scores).chosen,'legacy12');
 scores.asymmetric6.recovered.n=40;scores.asymmetric6.all.n=120;
 assert.equal(chooseInformationPolicy(scores).chosen,'asymmetric6');
 scores.asymmetric6.all.accuracy=.65;assert.equal(chooseInformationPolicy(scores).chosen,'legacy12');
});
const now=Date.UTC(2026,9,24),quote={fixtureId:1,bookmaker:'Book',market:'H',selection:'H',source:'API-Football',verifiedReceipt:true,odd:1.7,at:now-1000,observedAt:now-1000};
const game={fixture:{id:1,league:140,ts:now+86400000,status:'NS',finished:false},prediction:{sample:5,cutoff:now-100,probabilities:input.probabilities,contextAdjustment:{uncertainty:{spread:{H:.01,A:.01}}}},sourceUpdatedAt:now-1000,odds:{H:quote},sampleMatches:true,evidence:input.evidence,leagueAgeDays:1};
test('information preview never overrides missing quotes, EV, identity or chronology',()=>{
 const p=policy('asymmetric6'),before=structuredClone(game);
 const good=informationPreview(game,p,now);assert.equal(good.counterfactualRulesPass,true);assert.equal(good.publicationEligible,false);assert.deepEqual(game,before);
 assert.ok(informationPreview({...game,odds:{}},p,now).blockers.includes('market_unavailable'));
 assert.ok(informationPreview({...game,odds:{},oddsStatus:{H:'ready'}},p,now).blockers.includes('market_unavailable'));
 assert.ok(informationPreview({...game,odds:{H:{...quote,odd:1.3}}},p,now).blockers.includes('insufficient_expected_return'));
 assert.ok(informationPreview({...game,odds:{H:{...quote,fixtureId:2}}},p,now).blockers.includes('invalid_quote_identity'));
 assert.ok(informationPreview({...game,sampleMatches:false},p,now).blockers.includes('history_reconstruction_not_verified'));
 assert.ok(informationPreview({...game,prediction:{...game.prediction,cutoff:now+1}},p,now).blockers.includes('invalid_prediction_clock'));
});
test('prospective capture proves source clocks and fit counts and preserves frozen inputs',async()=>{
 const history=Array.from({length:15},(_,i)=>({id:i,league:140,season:2026,ts:now-(i+2)*DAY,home:10,away:20,hg:1,ag:0,status:'FT',finished:true}));
 const cutoff=now-100,info=teamInformation(history,10,cutoff),g={...game,fixture:{...game.fixture,home:10,away:20,season:2026},prediction:{...game.prediction,version:'test-v4',sample:info.components[0].weightMass,teams:{home:{n:15},away:{n:15}}},evaluation:{contract:'prospective-inputs-v1',validAtCapture:true,cutoff,recordedAt:now-50,inputHash:'a'.repeat(64),clocks:{fixture:now-1000,history:now-1000,context:0,detail:0,xg:0}}};
 const sources=history.map(f=>({data:JSON.stringify(f),updated_at:now-1000})),before=structuredClone(g);
 const snapshot=await informationSnapshot(g,history,sources,now,'asymmetric6');
 assert.equal(snapshot.publicationEligible,false);assert.equal(snapshot.contract,'information-comparison-v1');assert.match(snapshot.digest,/^[a-f0-9]{64}$/);assert.deepEqual(g,before);
 g.odds.H={...quote,odd:3};assert.equal(snapshot.odds.H.odd,1.7);
 await assert.rejects(informationSnapshot(before,history,sources.map(r=>({...r,updated_at:now+1})),now,'asymmetric6'),/source_clock/);
 await assert.rejects(informationSnapshot({...before,prediction:{...before.prediction,sample:99}},history,sources,now,'asymmetric6'),/profile_mismatch/);
 await assert.rejects(informationSnapshot(before,history,sources,before.fixture.ts,'asymmetric6'),/capture_clock/);
 await assert.rejects(informationSnapshot({...before,evaluation:{...before.evaluation,validAtCapture:false}},history,sources,now,'asymmetric6'),/unverified_original/);
});
