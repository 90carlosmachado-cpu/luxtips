import {dayLocked,lisbonClock,LIST_VERSION} from './daily-list.mjs';

export const REPLACEMENT_POLICY='best-three-until-lisbon-0800-v1';
export function freezeAt(day) {
  const utc=Date.parse(day+'T08:00:00Z');
  return utc-(lisbonClock(utc).hour-8)*3600000;
}
export function decisionScore(tip) {
  const score=tip?.decisionProbability??tip?.assessment?.decisionProbability??tip?.assessment?.conservativeProbability;
  return Number.isFinite(score)&&score>=0&&score<=1?score:null;
}
export function worstReplaceable(saved,candidate,games,now,assess) {
  if(dayLocked(candidate.day,now))return null;
  const choices=saved.filter(r=>r.day===candidate.day&&['H','A'].includes(r.market)&&r.kickoff>now).flatMap(row=>{
    let original;try{original=JSON.parse(row.data);}catch{return [];}
    const pick=original.displayTip||original.winnerTip;
    const current=games.find(g=>g.fixture.id===row.fixture_id&&g.fixture.ts===row.kickoff);
    const assessment=current?assess({...current,displayTip:{market:row.market}},now):null;
    const score=decisionScore(assessment?{assessment}:null)??decisionScore(pick);
    return score===null?[]:[{...row,score}];
  }).sort((a,b)=>a.score-b.score||b.fixture_id-a.fixture_id);
  const worst=choices[0],score=decisionScore(candidate.tip);
  return worst&&score!==null&&score>worst.score+1e-12?worst:null;
}

// Append archive markers and revisions; original publications remain immutable.
// The database clock and lease are rechecked inside the atomic batch.
export async function replaceDailyPick(db,old,g,tip,day,data,now,leaseToken) {
  const archivedAt=now,publishedAt=now+1,limit=freezeAt(day),reason=REPLACEMENT_POLICY+':'+g.fixture.id;
  const listKey='daily_list:'+LIST_VERSION+':football:'+day;
  if(dayLocked(day,now)||old.kickoff<=now||g.fixture.ts<=publishedAt||old.published_at>=archivedAt)return false;
  const clock="ROUND((julianday('now')-2440587.5)*86400000)";
  const archive=db.prepare(`INSERT INTO openfoot_publication_archives(day,fixture_id,archived_at,reason)
    SELECT day,fixture_id,?,? FROM openfoot_current_picks p
    WHERE p.day=? AND p.fixture_id=? AND p.published_at=? AND p.market IN ('H','A')
    AND p.kickoff>${clock} AND ${clock}<? AND ${clock}<?
    AND EXISTS(SELECT 1 FROM openfoot_locks WHERE key='publication' AND until=? AND until>${clock})
    AND NOT EXISTS(SELECT 1 FROM openfoot_state s,json_each(s.data,'$.items') i WHERE s.key=? AND
      (json_extract(s.data,'$.asOf')>? OR (json_extract(i.value,'$.gameId')=p.fixture_id AND json_extract(i.value,'$.lockedAt') IS NOT NULL)))
    AND (SELECT COUNT(*) FROM openfoot_current_picks WHERE day=? AND market IN ('H','A'))=3
    AND NOT EXISTS(SELECT 1 FROM openfoot_current_picks WHERE fixture_id=?)
    AND NOT EXISTS(SELECT 1 FROM openfoot_current_alternatives WHERE fixture_id=?)
    AND NOT EXISTS(SELECT 1 FROM fixtures f WHERE f.id=? AND (f.finished=1 OR f.kickoff<>? OR json_extract(f.data,'$.home')<>? OR json_extract(f.data,'$.away')<>? OR json_extract(f.data,'$.status')<>'NS'))`)
    .bind(archivedAt,reason,day,old.fixture_id,old.published_at,limit,g.fixture.ts-1,leaseToken,listKey,now,day,g.fixture.id,g.fixture.id,g.fixture.id,g.fixture.ts,g.fixture.home,g.fixture.away);
  const insert=db.prepare(`INSERT INTO openfoot_pick_revisions(day,fixture_id,kickoff,market,alternative,published_at,recorded_at,data)
    SELECT ?,?,?,?,0,?,?,? WHERE EXISTS(SELECT 1 FROM openfoot_publication_archives WHERE day=? AND fixture_id=? AND archived_at=? AND reason=?)
    AND NOT EXISTS(SELECT 1 FROM openfoot_current_picks WHERE fixture_id=?)
    AND NOT EXISTS(SELECT 1 FROM openfoot_current_alternatives WHERE fixture_id=?)`)
    .bind(day,g.fixture.id,g.fixture.ts,tip.market,publishedAt,publishedAt,JSON.stringify(data),day,old.fixture_id,archivedAt,reason,g.fixture.id,g.fixture.id);
  const payload={fixture:g.fixture,displayTip:data.displayTip,published:{at:publishedAt,alternative:false},sourceUpdatedAt:g.sourceUpdatedAt,
    history:{kind:'recommendation',provenance:'published'},historyStatus:'pending',result:null};
  const item={id:`${g.fixture.id}:${g.fixture.ts}:${tip.market}`,gameId:g.fixture.id,kickoff:g.fixture.ts,payload,kind:'recommendation',firstListedAt:publishedAt,lastEligibleAt:publishedAt,lockedAt:null};
  // Synchronize the displayed list in the same transaction, even if cron finishes
  // after 08:00. Otherwise it could freeze the removed card and show four games.
  const list=db.prepare(`UPDATE openfoot_state SET data=json_insert(
    json_set(data,'$.items',json((SELECT json_group_array(json(value)) FROM json_each(data,'$.items') WHERE json_extract(value,'$.gameId')<>?)),'$.asOf',?),
    '$.items[#]',json(?)) WHERE key=?
    AND EXISTS(SELECT 1 FROM openfoot_publication_archives WHERE day=? AND fixture_id=? AND archived_at=? AND reason=?)
    AND EXISTS(SELECT 1 FROM openfoot_current_picks WHERE fixture_id=? AND published_at=?)`)
    .bind(old.fixture_id,publishedAt,JSON.stringify(item),listKey,day,old.fixture_id,archivedAt,reason,g.fixture.id,publishedAt);
  const results=await db.batch([archive,insert,list]);
  return results[0].meta?.changes===1&&results[1].meta?.changes===1;
}
