import {POLICY,lisbonDay} from './policy.mjs';
import {CONTEXT_VERSION} from './model.mjs';
export function pendingReason(row,now){
 const f=JSON.parse(row.fixture_data);
 if(f.finished||f.status!=='NS'||f.ts<=now)return null;
 let g;try{g=row.data?JSON.parse(row.data):null;}catch{return 'invalid_forecast';}
 if(!g)return 'forecast_pending';
 if(g.fixture?.id!==f.id||g.fixture?.ts!==f.ts||g.fixture?.home!==f.home||g.fixture?.away!==f.away)return 'fixture_changed';
 if(g.prediction?.version!==CONTEXT_VERSION)return 'model_version_pending';
 if(g.selectionContract!=='selection-inputs-v2')return 'selection_inputs_pending';
 if(g.oddsCollection&&['incomplete_response','temporary_failure','quote_expired'].includes(g.oddsCollection.status))return g.oddsCollection.status;
 return null;
}
// One deadline per day/episode. New failures cannot extend a running deadline.
// After it expires, late recoveries can use free slots, never replace a pick.
export async function dayReadiness(db,rows,now,daysInWindow=[]){
 const groups=new Map(daysInWindow.map(day=>[day,[]]));
 for(const row of rows){const f=JSON.parse(row.fixture_data);if(f.status!=='NS'||f.finished||f.ts<=now)continue;const day=lisbonDay(f.ts);if(!groups.has(day))groups.set(day,[]);const reason=pendingReason(row,now);if(reason)groups.get(day).push({fixtureId:f.id,league:f.league,reason});}
 const days={};
 for(const [day,pending] of groups){
  const key='publication_day:'+day,old=await db.prepare('SELECT data FROM openfoot_state WHERE key=?').bind(key).first(),prior=old?JSON.parse(old.data):{};
  const since=pending.length?(prior.pendingSince??now):null;
  const deadline=since===null?null:since+POLICY.waitMs;
  const state={at:now,pendingSince:since,deadline,pending,status:pending.length?(now<deadline?'waiting':'partial_available'):'complete',reason:pending.length?(now<deadline?'waiting_for_day_pool':'pending_deadline_elapsed'):'day_pool_evaluated'};
  days[day]=state;
  await db.prepare('INSERT INTO openfoot_state(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').bind(key,JSON.stringify(state)).run();
 }
 return days;
}
