const MINUTE=60000;
export function oddsRetryDelay(status,complete,kickoff,now) {
  if(!complete)return MINUTE;
  if(status==='quote_expired'||status==='incomplete_response')return (kickoff-now<=24*60*MINUTE?15:30)*MINUTE;
  if(status==='market_unavailable')return 30*MINUTE;
  return 180*MINUTE;
}
export function oddsNextAttempt(state,kickoff,now) {
  const next=Number.isFinite(state.nextAt)?state.nextAt:0;
  if(!Number.isFinite(state.at))return next;
  if(['quote_expired','incomplete_response','market_unavailable'].includes(state.status))
    return Math.min(next,state.at+oddsRetryDelay(state.status,state.complete!==false,kickoff,now));
  return next;
}
export function priorityOddsFixture(rows,leagues,now) {
  return rows.flatMap(row=>{
    try {
      const f=JSON.parse(row.fixture_data),state=row.state_data?JSON.parse(row.state_data):{};
      if(f.finished||f.status!=='NS'||f.ts<=now||!leagues.includes(f.league))return [];
      const due=oddsNextAttempt(state,f.ts,now);
      return due<=now?[{fixture:f,due}]:[];
    } catch {return [];}
  }).sort((a,b)=>a.due-b.due||a.fixture.ts-b.fixture.ts||a.fixture.id-b.fixture.id)[0]?.fixture||null;
}
