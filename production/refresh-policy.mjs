const MINUTE=60000;
export function oddsRetryDelay(status,complete,kickoff,now,priority=2) {
  if(!complete)return MINUTE;
  if(status==='quote_expired'||status==='incomplete_response')return (kickoff-now<=24*60*MINUTE?15:30)*MINUTE;
  if(status==='market_unavailable')return 30*MINUTE;
  return (priority===0?15:priority===1?30:180)*MINUTE;
}
export function oddsNextAttempt(state,kickoff,now,priority=2) {
  const next=Number.isFinite(state.nextAt)?state.nextAt:0;
  if(!Number.isFinite(state.at))return next;
  if(['quote_expired','incomplete_response','market_unavailable'].includes(state.status))
    return Math.min(next,state.at+oddsRetryDelay(state.status,state.complete!==false,kickoff,now));
  if(state.status==='ready'&&priority<2)return Math.min(next,state.at+(priority===0?15:30)*MINUTE);
  return next;
}
export function priorityOddsFixture(rows,leagues,now) {
  return rows.flatMap(row=>{
    try {
      const f=JSON.parse(row.fixture_data),state=row.state_data?JSON.parse(row.state_data):{};
      if(f.finished||f.status!=='NS'||f.ts<=now||!leagues.includes(f.league))return [];
      const priority=Number.isInteger(row.priority)?row.priority:2,due=oddsNextAttempt(state,f.ts,now,priority);
      return due<=now?[{fixture:{...f,oddsPriority:priority},due,priority}]:[];
    } catch {return [];}
  }).sort((a,b)=>a.priority-b.priority||a.due-b.due||a.fixture.ts-b.fixture.ts||a.fixture.id-b.fixture.id)[0]?.fixture||null;
}
// Published selections get first claim on collection capacity. Near misses are
// ranked from forecasts, never from match outcomes or later prices.
export function prioritizeOddsRows(rows,now){
 const scored=rows.flatMap(row=>{try{const f=JSON.parse(row.fixture_data);if(f.finished||f.status!=='NS'||f.ts<=now)return [];const g=row.forecast_data?JSON.parse(row.forecast_data):null,p=g?.prediction,pr=p?.probabilities;let score=null;if(pr&&Number.isFinite(p.cutoff)&&p.cutoff<=now&&Number.isFinite(p.sample)&&p.sample>=4){const side=pr.H>=pr.A?'H':'A',m=p.contextAdjustment?.market,valid=m?.status==='available'&&Number.isFinite(m.probabilities?.[side])&&m.at<=m.observedAt&&m.observedAt<=p.cutoff&&now-m.at<21600000;score=valid?(pr[side]+m.probabilities[side])/2:pr[side];}return [{...row,f,score}];}catch{return [];}});
 const top=new Set(scored.filter(r=>!r.published&&Number.isFinite(r.score)).sort((a,b)=>b.score-a.score||a.f.ts-b.f.ts||a.f.id-b.f.id).slice(0,10).map(r=>r.f.id));
 return scored.map(({f,score,...r})=>({...r,priority:r.published?0:top.has(f.id)?1:2}));
}
export async function priorityOddsRows(db,now,end,leagues){
 if(!leagues.length)return [];
 const rows=await db.prepare(`SELECT f.data fixture_data,s.data state_data,c.data forecast_data,
 (EXISTS(SELECT 1 FROM openfoot_current_picks p WHERE p.fixture_id=f.id AND p.kickoff=f.kickoff)
 OR EXISTS(SELECT 1 FROM bigodds_all_legs l JOIN bigodds_tickets t ON t.id=l.ticket_id WHERE l.fixture_id=f.id AND l.kickoff=f.kickoff AND t.status='active')) published
 FROM fixtures f LEFT JOIN openfoot_state s ON s.key='odds_collection:'||f.id LEFT JOIN cache c ON c.key='forecast:'||f.id
 WHERE f.finished=0 AND f.kickoff>? AND f.kickoff<? AND f.league IN (${leagues.map(()=>'?').join(',')}) ORDER BY f.kickoff`).bind(now,end,...leagues).all();
 return prioritizeOddsRows(rows.results,now);
}
