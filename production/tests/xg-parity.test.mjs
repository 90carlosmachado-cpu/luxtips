import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {xgMarketModel,selectTicket,BIGODDS_POLICY} from '../bigodds-model.mjs';
import {candidatesFromQuotes,lisbonDay} from '../bigodds.mjs';
const R=JSON.parse(readFileSync(new URL('./xg-replay-data.json',import.meta.url),'utf8'));
test('new model matches the frozen Python xG candidate on all 278 fixture windows',()=>{
 const factories=new Map();let maxError=0;
 for(const target of R.targets){
  if(!factories.has(target.cut))factories.set(target.cut,xgMarketModel(R.history,target.cut,R.details));
  const p=factories.get(target.cut)(target.fixture);assert.equal(p.xgUsed,target.xgUsed);
  for(const [market,expected]of Object.entries(target.expected)){const error=Math.abs(p.probabilities[market]-expected);maxError=Math.max(maxError,error);assert.ok(error<1e-11,market+' error '+error);}
 }
 assert.ok(maxError<1e-11);
});
test('full 50/50 runtime selector reproduces the research no-unders ticket outcomes',()=>{
 let wins=0;const changes=[];
 for(const expected of R.tickets){
  const fixtures=R.targets.filter(t=>t.cut===expected.cut).map(t=>t.fixture),day=lisbonDay(expected.cut);
  const quotes=R.quotes.filter(q=>q[0]===day).map(q=>({fixture_id:q[1],kickoff:q[2],bookmaker:q[3],market:q[4],selection:q[5],odd:q[6],provider_at:q[7],observed_at:q[8]}));
  const candidates=candidatesFromQuotes(fixtures,quotes,xgMarketModel(R.history,expected.cut,R.details),expected.cut),ticket=selectTicket(candidates);assert.ok(ticket);assert.ok(ticket.legs.every(l=>!l.market.startsWith('U')));
  for(const l of ticket.legs)assert.ok(Math.abs(l.probabilities[l.market]-(l.modelProbability+l.marketProbability)/2)<1e-12);
  const ids=ticket.legs.map(l=>l.fixtureId+':'+l.market).sort(),ref=expected.legs.map(([id,m])=>id+':'+m).sort();
  if(JSON.stringify(ids)!==JSON.stringify(ref))changes.push({day,ids,ref});
  const won=ticket.legs.every(l=>{const h=R.history.find(r=>r.id===l.fixtureId);return l.market==='1'?h.hg>h.ag:l.market==='2'?h.ag>h.hg:l.market==='1X'?h.hg>=h.ag:l.market==='X2'?h.ag>=h.hg:l.market==='BY'?h.hg>0&&h.ag>0:l.market==='BN'?h.hg===0||h.ag===0:h.hg+h.ag>Number(l.market[1]);});wins+=Number(won);
 }
 assert.equal(wins,6);assert.equal(changes.length,0,JSON.stringify(changes));
});
test('invalid, unavailable, duplicate or conflicting xG cannot contaminate predictions',()=>{
 const target=R.targets.find(t=>t.xgUsed),now=target.cut,base=xgMarketModel(R.history,now,R.details)(target.fixture);
 const future=R.details.map(d=>({...d,observed_at:now+1,data:{...d.data,observedAt:now+1}}));assert.equal(xgMarketModel(R.history,now,future)(target.fixture).xgUsed,false);
 assert.deepEqual(xgMarketModel(R.history,now,[...R.details,...R.details])(target.fixture),base);
 const bad=R.details.map(d=>({...d,data:{...d.data,result:{home:99,away:99}}}));assert.equal(xgMarketModel(R.history,now,bad)(target.fixture).xgUsed,false);
 const nan=R.details.map(d=>({...d,data:{...d.data,homeXg:NaN}}));assert.equal(xgMarketModel(R.history,now,nan)(target.fixture).xgUsed,false);
});
test('active policy is exactly the authorized research candidate',()=>{assert.equal(BIGODDS_POLICY.prior,2);assert.equal(BIGODDS_POLICY.halfLifeDays,90);assert.equal(BIGODDS_POLICY.marketWeight,.5);assert.equal(BIGODDS_POLICY.xgWeight,1);assert.equal(BIGODDS_POLICY.minXgRoleWeighted,2);assert.equal(BIGODDS_POLICY.days,3);assert.ok(BIGODDS_POLICY.markets.every(m=>!m.startsWith('U')));});
