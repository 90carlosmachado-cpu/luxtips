import {fit,fit2,predict2} from '../legacy-worker.mjs';
import {competitionFor} from './config.mjs';

export const LIVE_STRENGTH_PRIOR=4;
export function fitStrength(history,cutoff,prior=8){
 if(![4,8].includes(prior))throw new RangeError('unsupported_strength_prior');
 if(prior===8)return fit2(history,cutoff);
 // Reuse the existing component weights/horizons. Only shrinkage changes.
 return fit2([],cutoff).map(c=>({...c,state:fit(history,cutoff,{...c.state.opts,prior})}));
}
export function strengthAdjustment(league){
 return {version:'league-strength-prior4-v1',prior:competitionFor(league)?LIVE_STRENGTH_PRIOR:8,
  scope:'prior4 in the five xG leagues; other leagues and detail fits unchanged',xgMaximumWeight:.5};
}
export function fitLiveStrength(history,cutoff,league){return fitStrength(history,cutoff,strengthAdjustment(league).prior);}
export function predictLiveStrength(states,fixture){return {...predict2(states,fixture),strengthAdjustment:strengthAdjustment(fixture.league)};}
