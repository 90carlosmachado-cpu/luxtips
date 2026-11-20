import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {BIGODDS_POLICY,qualityMarketModel,analyzeTicketExact} from '../bigodds-model.mjs';
import {optimizeBigOdds} from '../bigodds-optimizer.mjs';
import {candidatesFromQuotes,publishBigOdds} from '../bigodds.mjs';
import {qualityLeg} from './bigodds-quality-fixtures.mjs';
import {bigOddsClient} from '../bigodds-view.mjs';
import {analysisDetails} from '../front-office.mjs';
import {legState,ticketProgress} from '../ticket-presentation.mjs';

const NOW=Date.parse('2026-11-16T08:00:00Z'),DAY=86400000;
const fixture=id=>({id,home:id*2,away:id*2+1,league:39,ts:NOW+DAY,homeName:'H'+id,awayName:'A'+id});
const legs=(count=3)=>Array.from({length:count},(_,i)=>qualityLeg(fixture(i+1),NOW));
const ticket=all=>({bookmaker:'Betano',odd:all.reduce((odd,l)=>odd*l.odd,1),legs:all});
const noWrites={prepare(){throw new Error('rejected ticket must not reach storage');}};

test('quality policy admits the available games above odd 2 without inflating confidence',()=>{
 const a=analyzeTicketExact(legs(),NOW);
 assert.equal(a.status,'optimal');assert.equal(a.ticket.legs.length,3);
 assert.ok(a.ticket.odd>=2);assert.ok(a.ticket.probability>=.20);
 assert.equal(a.probabilityCalibrationValidated,false);
 assert.equal(a.ticket.optimization.independentGamesAssumed,true);
});

test('quality failures are independently enforced before publisher writes',async()=>{
 const cases=[
  ['missing_probability_components',l=>{delete l.marketProbability;}],
  ['inconsistent_probability_components',l=>{l.probability=.85;}],
  ['market_probability_below_minimum',l=>{l.marketProbability=.69;l.modelProbability=.95;l.probability=.82;}],
  ['model_market_disagreement',l=>{l.modelProbability=.99;l.probability=.87;}],
  ['incoherent_reference_clock',l=>{l.referenceAt--;}],
  ['insufficient_model_evidence',l=>{delete l.model.evidence;}],
  ['insufficient_model_evidence',l=>{l.model.evidence.home.games=7;}],
  ['insufficient_model_evidence',l=>{l.model.evidence.away.weighted=3.9;}],
  ['insufficient_model_evidence',l=>{l.model.evidence.home.lastAt=NOW-91*DAY;}],
  ['insufficient_model_evidence',l=>{l.model.evidence.home.lastAt=NOW-3600000;}],
  ['insufficient_role_evidence',l=>{l.model.evidence.home.roleGames=2;}],
  ['invalid_model_cutoff',l=>{l.model.cutoff=NOW+1;}],
  ['invalid_model_cutoff',l=>{l.model.cutoff=NOW-21600000;}],
  ['inconsistent_evidence_scope',l=>{l.model.evidence.scope='national_official';}],
 ];
 for(const [reason,mutate]of cases){
  const all=legs();mutate(all[0]);
  const a=analyzeTicketExact(all,NOW);
  assert.equal(a.status,'no_eligible_ticket',reason);assert.ok(a.rejections[reason]>=1,reason);
  const r=await publishBigOdds(noWrites,ticket(all),NOW);
  assert.equal(r.status,'quality_rejected',reason);assert.equal(r.reason,reason);
 }
});

test('probability floors reject weak legs and retain the largest valid subset of a long ticket',async()=>{
 const low=legs();low[0].probability=.74;low[0].modelProbability=.73;
 assert.equal((await publishBigOdds(noWrites,ticket(low),NOW)).status,'probability_below_minimum');
 const all=legs(8).map(l=>({...l,probability:.80,modelProbability:.85}));
 assert.ok(.80*1.3>1); // Every leg has a positive estimated EV.
 const selected=analyzeTicketExact(all,NOW);
 assert.equal(selected.status,'optimal');assert.equal(selected.ticket.legs.length,7);
 assert.ok(selected.ticket.probability>=.20);
 assert.equal((await publishBigOdds(noWrites,ticket(all),NOW)).status,'joint_probability_below_minimum');
});

test('raising odds never substitutes for quality, even if more legs can reach the target',()=>{
 const all=legs(12).map(l=>({...l,probability:.80,modelProbability:.85}));
 // Isolate the joint floor with a deliberately long ticket; runtime can choose fewer legs.
 const policy={...BIGODDS_POLICY,minLegs:8,now:NOW};
 assert.equal(optimizeBigOdds(all,policy).ticket,null);
 const lower=optimizeBigOdds(all,{...policy,minJointProbability:0});
 assert.equal(lower.status,'optimal');assert.ok(lower.ticket.probability<.20);
});

test('double chance price and its 1X2 reference must share the provider clock',()=>{
 const f=fixture(1),base={fixture_id:f.id,kickoff:f.ts,bookmaker:'Betano',provider_at:NOW-1000,observed_at:NOW-500};
 const q=[...Object.entries({Home:1.8,Draw:3.5,Away:4.5}).map(([selection,odd])=>({...base,market:'Match Winner',selection,odd})),{...base,market:'Double Chance',selection:'Home/Draw',odd:1.3}];
 const predict=()=>({probabilities:{'1':.6,'2':.15,'1X':.85,X2:.4}});
 assert.ok(candidatesFromQuotes([f],q,predict,NOW).some(l=>l.market==='1X'));
 q.at(-1).provider_at-=1000;
 assert.ok(!candidatesFromQuotes([f],q,predict,NOW).some(l=>l.market==='1X'));
});

test('real 16 November snapshot rejects the previous five selections without missing-history excuses',()=>{
 const root=new URL('../../research/bigodes-quality-20261116/',import.meta.url);
 const history=JSON.parse(readFileSync(new URL('national-history.json',root)));
 const snapshot=JSON.parse(readFileSync(new URL('decision-snapshot.json',root)));
 const predict=qualityMarketModel(history,NOW);
 const rows=snapshot.candidates.map(l=>{
  const model=predict({id:l.fixtureId,home:l.home,away:l.away,league:l.league,ts:l.kickoff});
  const p=model.probabilities[l.market];
  return {...l,modelProbability:p,probabilities:{...model.probabilities,[l.market]:(p+l.marketProbability)/2},modelProbabilities:model.probabilities,model:{...model,probabilities:undefined}};
 });
 const a=analyzeTicketExact(rows,NOW);
 assert.equal(a.status,'no_eligible_ticket');assert.equal(a.fixtureCount,1);
 for(const [id,market,maxP]of [[1528999,'1X',.70],[1528998,'1X',.72],[1545662,'O15',.67],[1528995,'X2',.58],[1528994,'X2',.56]]){
  const row=rows.find(l=>l.fixtureId===id&&l.market===market);
  assert.ok(row);assert.equal(row.model.quality.eligible,true);
  assert.ok(row.model.homeSample>=16&&row.model.awaySample>=16);
  assert.ok(row.probabilities[market]<maxP);
 }
});

test('exact optimizer with quality floor agrees with independent enumeration',()=>{
 let seed=74139;
 const random=()=>((seed=(1664525*seed+1013904223)>>>0)/2**32);
 for(let run=0;run<40;run++){
  const all=legs(8).map(l=>{
   const market=.70+random()*.12,model=Math.min(.99,market+random()*.15),p=(market+model)/2;
   return {...l,odd:1.2+random()*.3,probability:p,marketProbability:market,modelProbability:model};
  });
  const valid=all.filter(l=>l.probability>=.75&&l.probability*l.odd>=1-1e-12);
  let best={count:0,probability:0};
  for(let mask=0;mask<2**valid.length;mask++){
   const chosen=valid.filter((_,i)=>mask&(1<<i));
   const p=chosen.reduce((v,l)=>v*l.probability,1),odd=chosen.reduce((v,l)=>v*l.odd,1);
   if(chosen.length>=2&&odd>=2&&p>=.2-1e-12&&p*odd>=1.03-1e-12&&
      (chosen.length>best.count||chosen.length===best.count&&p>best.probability))best={count:chosen.length,probability:p};
  }
  const answer=analyzeTicketExact(all,NOW);
  assert.equal(answer.ticket?.legs.length??0,best.count,'enumeration count '+run);
  assert.ok(Math.abs((answer.ticket?.probability??0)-best.probability)<1e-10,'enumeration probability '+run);
 }
});

test('Bigodes analysis labels the actual decision probability and national history accurately',async()=>{
 const l=qualityLeg(fixture(1),NOW);l.status='pending';l.currentQuote={odd:1.3,status:'ready'};
 l.model={...l.model,source:'national-opponent-strength',homeSample:20,awaySample:18,homeGoals:1.4,awayGoals:.8,xgUsed:false};
 const t={id:'test',createdAt:NOW,status:'active',legs:[l],currentOdd:1.3,currentOddStatus:'ready'};
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',classList:{toggle(){}},setAttribute(){}});return nodes.get(id);};
 const context=vm.createContext({console,Date,Intl,Map,Set,String,Number,JSON,Object,Promise,AbortController,setTimeout,clearTimeout,setInterval(){},encodeURIComponent,
  legState,ticketProgress,analysisDetails,disclosureEvents(){},stableDom:(target,markup)=>{target.innerHTML=markup;},
  document:{querySelector:node,querySelectorAll:()=>[],addEventListener(){}},
  fetch:async()=>({ok:true,json:async()=>({current:t,history:[t],summary:{active:1},nextCursor:null})})});
 vm.runInContext('('+bigOddsClient.toString()+')(stableDom,analysisDetails,disclosureEvents)',context);
 await new Promise(resolve=>setImmediate(resolve));
 const html=node('#bigCurrent').innerHTML;
 assert.match(html,/Probabilidade de decisão · 50% modelo \+ 50% Betano/);
 assert.match(html,/82,0%/);assert.match(html,/Modelo estatístico<\/dt><dd>89%/);
 assert.doesNotMatch(html,/Probabilidade do modelo/);
 assert.match(html,/Golos · força dos adversários/);
 assert.match(html,/Jogos oficiais · equipa da casa \/ de fora/);
 assert.doesNotMatch(html,/As amostras referem-se à condição casa ou fora na competição/);
});
