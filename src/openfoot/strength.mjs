import {fit,fit2,predict2} from '../legacy-worker.mjs';
import {competitionFor} from './config.mjs';

export const LIVE_STRENGTH_PRIOR=4;
export const LIVE_ELO_WEIGHT=.2;
export function fitStrength(history,cutoff,prior=8,eloWeight=0){
 if(![4,8].includes(prior))throw new RangeError('unsupported_strength_prior');
 if(!Number.isFinite(eloWeight)||eloWeight<0||eloWeight>1)throw new RangeError('unsupported_elo_weight');
 if(prior===8&&eloWeight===0)return fit2(history,cutoff);
 // Reuse the existing component weights/horizons. Shrinkage and Elo are explicit.
 return fit2([],cutoff).map(c=>({...c,state:fit(history,cutoff,{...c.state.opts,prior,eloWeight})}));
}
export function strengthAdjustment(league){
 return {version:'league-strength-elo020-v2',eloWeight:LIVE_ELO_WEIGHT,eloResults:'actual-results-only',prior:competitionFor(league)?LIVE_STRENGTH_PRIOR:8,
  scope:'Elo 0.2 in all ten leagues; prior4 in five xG leagues; detail fits unchanged',xgMaximumWeight:.5};
}
export function fitLiveStrength(history,cutoff,league){return fitStrength(history,cutoff,strengthAdjustment(league).prior,LIVE_ELO_WEIGHT);}
export function predictLiveStrength(states,fixture){return {...predict2(states,fixture),strengthAdjustment:strengthAdjustment(fixture.league)};}
