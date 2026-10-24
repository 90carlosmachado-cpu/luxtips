import {teamInformation,incomingTeamStatus,DAY} from './evidence.mjs';
import {INFORMATION_POLICIES} from './information-policy.mjs';
import {informationPreview} from './information-preview.mjs';
export const INFORMATION_CONTRACT='information-comparison-v1';
// Pure prospective capture builder. Returns an immutable-value snapshot to the
// caller; does not write D1 or register jobs. Pass the actual CLEAN fit history.
export async function informationSnapshot(game,cleanHistory,historySources,recordedAt,policyId){
 const g=structuredClone(game),p=g.prediction,f=g.fixture,cutoff=p?.cutoff,policy=INFORMATION_POLICIES.find(x=>x.id===policyId);
 if(!policy||!f||f.finished||f.status!=='NS'||!Number.isFinite(f.ts)||!Number.isFinite(cutoff)||!Number.isFinite(recordedAt)||cutoff>recordedAt||recordedAt>=f.ts||!Number.isFinite(g.sourceUpdatedAt)||g.sourceUpdatedAt>cutoff||typeof p.version!=='string')throw Error('invalid_prospective_capture_clock');
 const evaluation=g.evaluation;
 if(evaluation?.contract!=='prospective-inputs-v1'||evaluation.validAtCapture!==true||evaluation.cutoff!==cutoff||!Number.isFinite(evaluation.recordedAt)||evaluation.recordedAt<cutoff||evaluation.recordedAt>recordedAt||!/^[a-f0-9]{64}$/.test(evaluation.inputHash)||!['fixture','history','context','detail','xg'].every(k=>Number.isFinite(evaluation.clocks?.[k])&&evaluation.clocks[k]<=cutoff))throw Error('unverified_original_forecast');
 if(![39,140,78,135,61].includes(f.league))throw Error('unvalidated_information_league');
 const history=cleanHistory.filter(x=>x.finished&&x.ts+7200000<cutoff&&x.ts>cutoff-3*365*DAY);
 if(!history.length||history.some(x=>x.league!==f.league||x.status!=='FT'||!Number.isInteger(x.hg)||!Number.isInteger(x.ag)||x.hg<0||x.ag<0))throw Error('invalid_fit_history');
 const ids=new Set(history.map(x=>x.id));if(ids.size!==history.length)throw Error('duplicate_fit_history');
 const sources=new Map();
 for(const r of historySources){let data;try{data=typeof r.data==='string'?JSON.parse(r.data):r.data;}catch{throw Error('invalid_history_source');}
  if(!data||!ids.has(data.id))continue;
  if(sources.has(data.id)||!Number.isFinite(r.updated_at)||r.updated_at>cutoff)throw Error('invalid_history_source_clock');
  sources.set(data.id,{data,updatedAt:r.updated_at});
 }
 for(const x of history){const s=sources.get(x.id);if(!s||['id','league','home','away','ts','hg','ag','finished','status'].some(k=>s.data[k]!==x[k]))throw Error('history_source_mismatch');}
 const home=teamInformation(history,f.home,cutoff),away=teamInformation(history,f.away,cutoff),sample=Math.min(home.components[0].weightMass,away.components[0].weightMass);
 if(!Number.isFinite(p.sample)||Math.abs(sample-p.sample)>1e-8||home.rawMatches!==p.teams?.home?.n||away.rawMatches!==p.teams?.away?.n)throw Error('fit_profile_mismatch');
 const evidence={home,away,incoming:[f.home,f.away].map(id=>incomingTeamStatus(history,f,id,cutoff))},leagueAgeDays=(cutoff-Math.max(...history.map(x=>x.ts)))/DAY;
 const input={...g,evidence,leagueAgeDays,sampleMatches:true};
 const baseline=informationPreview(input,INFORMATION_POLICIES[0],recordedAt),candidate=informationPreview(input,policy,recordedAt);
 const record={contract:INFORMATION_CONTRACT,policyId,recordedAt,cutoff,modelVersion:p.version,fixture:structuredClone(f),probabilities:structuredClone(p.probabilities),legacySample:p.sample,evidence,leagueAgeDays,
  sourceClocks:{...evaluation.clocks,fixture:g.sourceUpdatedAt,history:Math.max(...[...sources.values()].map(x=>x.updatedAt))},
  originalCapture:{contract:evaluation.contract,recordedAt:evaluation.recordedAt,inputHash:evaluation.inputHash},
  baseline,candidate,odds:structuredClone(g.odds??{}),oddsStatus:structuredClone(g.oddsStatus??{}),modelDisagreement:structuredClone(p.contextAdjustment?.uncertainty?.spread??{}),marketReference:structuredClone(p.contextAdjustment?.market??null),
  publicationEligible:false,rule:'Final24h: first valid forecast for information; separately first valid-price snapshot for price rules. Never choose by a later higher probability, positive EV or result.'};
 const bytes=new TextEncoder().encode(JSON.stringify(record));
 const digest=await crypto.subtle.digest('SHA-256',bytes);record.digest=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
 return record;
}
