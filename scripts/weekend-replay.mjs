import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fit2, predict2 } from '../src/legacy-worker.mjs';
import { createOpenFootClient } from '../src/openfoot/client.mjs';
import { competitionFor, seasonLabel } from '../src/openfoot/config.mjs';
import { matchFixture, normalizeXg } from '../src/openfoot/normalize.mjs';

const cutoff = Date.parse('2026-10-16T23:00:00Z'); // 17 Oct 00:00 Europe/Lisbon
const policy = { cutoff, range: ['2026-10-17','2026-10-18'], leagues: [39,140,78,135,61],
  selection: 'highest H/A probability among weekend fixtures with effective sample >=12; ties by kickoff then fixture ID',
  xgWeight: 0.5, targetOutcomeFieldsPassedToModel: false,
  priorConversationContainsTargetOutcome: true,
  retrospective: true, sourceAvailabilityAtCutoffVerified: false,
  parameterSelection: 'unchanged deployed model and predeclared 50% xG blend; no tuning against weekend outcomes' };
const history = [];
for (const name of await readdir('work/weekend-history')) {
  for (const f of JSON.parse(await readFile(`work/weekend-history/${name}`,'utf8'))) history.push({
    id:f[0],league:f[1],ts:f[2],home:f[3],away:f[4],homeName:f[5],awayName:f[6],hg:f[7],ag:f[8],season:f[9],finished:true,status:'FT',
  });
}
if (history.some(f=>f.ts>=cutoff)) throw new Error('future_history');
const targets = JSON.parse(await readFile('work/weekend-targets.json','utf8'));
if (targets.some(f=>Object.hasOwn(f,'hg')||Object.hasOwn(f,'ag')||Object.hasOwn(f,'score'))) throw new Error('target_result_leak');
const states = new Map(policy.leagues.map(l=>[l,fit2(history.filter(f=>f.league===l),cutoff)]));
const ranked = targets.map(f=>({ fixture:{...f,finished:false,status:'NS'}, prediction:predict2(states.get(f.league),f) }))
  .filter(x=>x.prediction.sample>=12).sort((a,b)=>Math.max(b.prediction.probabilities.H,b.prediction.probabilities.A)-Math.max(a.prediction.probabilities.H,a.prediction.probabilities.A)||a.fixture.ts-b.fixture.ts||a.fixture.id-b.fixture.id);
const selected = ranked[0];
if (!selected) throw new Error('no_candidate');
const declaration = { policy, selected: selected.fixture, baseline: selected.prediction, candidates:ranked.length };
await writeFile('work/weekend-declaration.json',JSON.stringify(declaration,null,2));
const declarationHash = createHash('sha256').update(JSON.stringify(declaration)).digest('hex');
console.log(JSON.stringify({ phase:'selection_frozen',declarationHash,fixture:selected.fixture.homeName+' — '+selected.fixture.awayName,league:selected.fixture.league }));

const text = await readFile('.dev.vars','utf8');
const line = text.split(/\r?\n/).find(l=>/^\s*OPENFOOT_API_KEY\s*=/.test(l));
const key = line?.slice(line.indexOf('=')+1).trim().replace(/^(['"])(.*)\1$/,'$2');
if (!key) throw new Error('missing_key');
let previousCall = 0;
const client = createOpenFootClient({ key, maximumRequests:400, fetcher:async(...args)=>{
  const pause=750-(Date.now()-previousCall);
  if(pause>0) await new Promise(resolve=>setTimeout(resolve,pause));
  previousCall=Date.now();
  return fetch(...args);
} });
const fixture=selected.fixture, comp=competitionFor(fixture.league), leagueHistory=history.filter(f=>f.league===fixture.league);
const relevant = leagueHistory.filter(f=>f.home===fixture.home||f.away===fixture.home||f.home===fixture.away||f.away===fixture.away);
const observations = [], errors=[];
for(const year of [...new Set(relevant.map(f=>f.season))].sort((a,b)=>b-a)) {
  const season=seasonLabel(year), inventoryPath=`work/replay-inventory-${fixture.league}-${year}.json`;
  let matches;
  try { matches=JSON.parse(await readFile(inventoryPath,'utf8')); }
  catch {
    if(year===2025) matches=JSON.parse(await readFile(`work/inventory/${fixture.league}.json`,'utf8'));
    else matches=await client.allMatches(comp.id,season);
    // Discard all target-weekend and subsequent rows at this boundary.
    matches=matches.filter(m=>Date.parse(m.kickoffAt)+2*3600000<cutoff);
    await writeFile(inventoryPath,JSON.stringify(matches));
  }
  for(const m of matches) {
    if(Date.parse(m.kickoffAt)+2*3600000>=cutoff) continue;
    const match=matchFixture(m,relevant);
    if(match.status!=='matched') continue;
    const cachePath=`work/replay-xg-${match.fixture.id}.json`;
    let o;
    try {
      try { o=JSON.parse(await readFile(cachePath,'utf8')); }
      catch {
        const p=await client.get(`/v1/matches/${encodeURIComponent(m.id)}/xg`);
        o={...normalizeXg(m,p),fixtureId:match.fixture.id,league:fixture.league,kickoff:match.fixture.ts};
        await writeFile(cachePath,JSON.stringify(o));
      }
      observations.push(o);
    }catch(e){ errors.push({fixtureId:match.fixture.id,code:e.code||'xg_unavailable'}); }
    if(observations.length%20===0) console.log(JSON.stringify({phase:'xg_history',observations:observations.length,requests:client.requests}));
  }
}
const byId=new Map(observations.map(o=>[o.fixtureId,o]));
const coverage=[fixture.home,fixture.away].map(id=>{
  const rows=relevant.filter(f=>f.home===id||f.away===id);
  const n=rows.filter(f=>byId.has(f.id)).length;
  return {teamId:id,total:rows.length,xg:n,coverage:rows.length?n/rows.length:0};
});
if(coverage.some(x=>x.xg<12||x.coverage<0.7)) throw new Error('insufficient_replay_coverage');
const blended=leagueHistory.map(f=>{
  const o=byId.get(f.id);
  return o?{...f,hg:0.5*f.hg+0.5*o.homeXg,ag:0.5*f.ag+0.5*o.awayXg}:f;
});
const enriched=predict2(fit2(blended,cutoff),fixture);
const market=enriched.probabilities.H>enriched.probabilities.A?'H':'A';
const probability=enriched.probabilities[market];
const report={policy,declarationHash,fixture,market,selection:(market==='H'?fixture.homeName:fixture.awayName)+' vence',
  probability,fairOdd:1/probability,probabilities:enriched.probabilities,homeGoals:enriched.homeGoals,awayGoals:enriched.awayGoals,
  topScores:enriched.luxg.topScores,baseline:selected.prediction.probabilities,coverage,observations:observations.length,
  errors:errors.length,requests:client.requests,actualOdds:null,actualOutcome:null,
  limitation:'Retrospective event-time reconstruction: source revisions and historical availability are unverified; model parameters and team mappings were developed later. This is not an independent blind test.'};
await writeFile('work/weekend-replay.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({phase:'prediction_frozen',...report},null,2));
