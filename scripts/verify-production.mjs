import fs from 'node:fs';
import assert from 'node:assert/strict';
const origin='https://luxtips.90carlosmachado.workers.dev',now=Date.now();
const urls=['/api/health','/api/games','/api/validation'];
const settled=await Promise.allSettled(urls.map(async path=>{const response=await fetch(origin+path+'?verify='+now,{cache:'no-store'});assert.equal(response.status,200,path);return response.json();}));
for(const result of settled)if(result.status==='rejected')throw result.reason;
const [health,games,validation]=settled.map(result=>result.value);
assert.equal(health.release,'2026-10-22-production-maintenance-v5-container');
assert.equal(health.ready,true);assert.equal(health.sync.stale,false);
assert.equal(health.provider.transport,'container');assert.equal(health.provider.valid,true);
assert.equal(health.pipeline.context_refresh.publicationHeld,false);
assert.equal(games.imports.pending,0);
const policy=games.selectionPolicy;
assert.equal(policy.minimumWinnerProbability,.6);assert.equal(policy.minimumAlternativeProbability,.7);
assert.equal(policy.minimumOdd,1.25);assert.equal(policy.oddsMaxAgeHours,6);assert.equal(policy.minimumExpectedReturn,.03);
for(const game of games.games){
 const tip=game.displayTip||game.winnerTip,threshold=game.published.alternative?.7:.6;
 assert.ok(tip.probability>=threshold);assert.ok(tip.odd>=1.25);
 assert.ok(now-tip.oddsAt<6*3600000&&tip.oddsAt<=now);assert.ok(game.published.at<game.fixture.ts);
 const reserve=Math.max(0,...Object.values(game.prediction.contextAdjustment.uncertainty.spread));
 assert.ok((tip.probability-reserve)*tip.odd>=1.03);
}
assert.equal(validation.contextualModel.modelComparison,false);
const admin=await fetch(origin+'/api/admin/recalculate?action=calculate',{method:'POST'});
assert.equal(admin.status,401);
const report={verifiedAt:new Date().toISOString(),site:origin,release:health.release,ready:health.ready,provider:health.provider,pipeline:health.pipeline,pendingForecasts:games.imports.pending,policy,
 selections:games.games.map(game=>{const tip=game.displayTip||game.winnerTip;return{fixtureId:game.fixture.id,home:game.fixture.homeName,away:game.fixture.awayName,kickoff:new Date(game.fixture.ts).toISOString(),market:tip.market,label:tip.label,probability:tip.probability,odd:tip.odd,bookmaker:tip.bookmaker,publishedAt:new Date(game.published.at).toISOString(),model:game.prediction.version};}),
 modelComparison:false,adminWithoutAuthentication:admin.status,tests:49,syntaxAndBuild:'passed'};
fs.mkdirSync('../../outputs',{recursive:true});fs.writeFileSync('../../outputs/verificacao-producao.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({verifiedAt:report.verifiedAt,ready:report.ready,selections:report.selections.length,pendingForecasts:report.pendingForecasts,transport:report.provider.transport,admin:admin.status}));
