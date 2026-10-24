import {assessInformation} from './information-policy.mjs';
import {quoteStatus,POLICY} from '../context/policy.mjs';
// A complete list of downstream blockers for a counterfactual sample policy.
// Diagnostic only: no mutation, publication or claim of a validated bet.
export function informationPreview(g,policy,now){
 const p=g.prediction,f=g.fixture,probabilities=p?.probabilities;
 const information=assessInformation({probabilities,legacySample:p?.sample,evidence:g.evidence,leagueAgeDays:g.leagueAgeDays},policy);
 const market=probabilities?.H>=probabilities?.A?'H':'A',q=g.odds?.[market],probability=probabilities?.[market],reserve=p?.contextAdjustment?.uncertainty?.spread?.[market];
 const blockers=[];
 if(g.sampleMatches!==true)blockers.push('history_reconstruction_not_verified');
 if(!information.eligible)blockers.push(information.reason);
 if(!f||f.finished||f.status!=='NS'||!Number.isFinite(f.ts)||f.ts<=now)blockers.push('not_prematch');
 if(!Number.isFinite(probability)||probability<.6)blockers.push('insufficient_probability');
 if(!Number.isFinite(g.sourceUpdatedAt)||g.sourceUpdatedAt>now||now-g.sourceUpdatedAt>24*3600000)blockers.push('stale_fixture_source');
 if(!Number.isFinite(p?.cutoff)||p.cutoff>now||p.cutoff>=f?.ts)blockers.push('invalid_prediction_clock');
 const wrongIdentity=q&&(q.fixtureId!==f?.id||typeof q.bookmaker!=='string'||!q.bookmaker);
 const missingStatus=['quote_expired','temporary_failure','incomplete_response','market_unavailable'].includes(g.oddsStatus?.[market])?g.oddsStatus[market]:'market_unavailable';
 const priceState=wrongIdentity?'invalid_quote_identity':q?quoteStatus(q,market,now,f?.ts):missingStatus;
 if(priceState!=='ready')blockers.push(priceState);
 let expectedReturn=null;
 if(!Number.isFinite(reserve)||reserve<0||reserve>1)blockers.push('invalid_component_divergence');
 else if(priceState==='ready'){expectedReturn=Math.max(0,probability-reserve)*q.odd-1;if(expectedReturn<POLICY.minimumExpectedReturn)blockers.push('insufficient_expected_return');}
 return {fixtureId:f?.id,home:f?.homeName,away:f?.awayName,probability,market,legacySample:p?.sample,information,priceState,odd:priceState==='ready'?q.odd:null,expectedReturn,blockers:[...new Set(blockers)],
  counterfactualRulesPass:!blockers.length,publicationEligible:false,validatedStudyLeague:[39,140,78,135,61].includes(f?.league),note:'Research preview only; daily capacity, version/readiness and live publication are not simulated.'};
}
