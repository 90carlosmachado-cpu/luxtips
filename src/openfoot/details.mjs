import {normalizeXg,teamName} from './normalize.mjs';
import {OpenFootError} from './client.mjs';
// Incident times are minute-resolution. Same-minute ordering is only resolved
// for a uniquely identified scoring shot; other ambiguous shots stay unclassified.
export function normalizeMatchDetails(match,xgPayload,eventPayload,observedAt=Date.now()){
 const observation=normalizeXg(match,xgPayload,observedAt),d=eventPayload?.data;
 if(d?.matchId!==match.id||!Array.isArray(d.events)||d.events.length>500||!d.events.length||eventPayload.meta?.unavailable?.length||!eventPayload.meta?.sources?.some(s=>s.name==='FotMob'))throw new OpenFootError('invalid_event_contract');
 const teams=new Map([[match.homeTeam.id,'home'],[match.awayTeam.id,'away']]),ids=new Set(),events=[];
 for(const e of d.events){
  if(typeof e.id!=='string'||!e.id||ids.has(e.id)||!Number.isInteger(e.minute)||e.minute<0||e.minute>130||typeof e.type!=='string')throw new OpenFootError('invalid_event');
  ids.add(e.id);
  const side=teams.get(e.teamId);
  const penaltyShots=e.type==='penalty'?xgPayload.data.shots.filter(s=>s.situation==='Penalty'&&s.minute===e.minute&&teamName(s.player)===teamName(e.player)&&teamName(s.team)===teamName(side==='home'?match.homeTeam.name:match.awayTeam.name)):[];
  if(e.type==='penalty'&&penaltyShots.length!==1)throw new OpenFootError('ambiguous_penalty_event');
  const goal=['goal','penalty_goal'].includes(e.type)||(e.type==='penalty'&&penaltyShots[0].result==='Goal'),red=['red_card','second_yellow_card','yellow_red_card'].includes(e.type);
  if((goal||red)&&!side)throw new OpenFootError('invalid_event_team');
  if(/red|second.*yellow/i.test(e.type)&&!red)throw new OpenFootError('ambiguous_card_event');
  if(/goal/i.test(e.type)&&!goal)throw new OpenFootError('ambiguous_goal_event');
  if(goal||red)events.push({id:e.id,minute:e.minute,clock:Math.min(90,e.minute),side,goal,red,player:e.player,type:e.type,detail:e.detail});
 }
 const goals={home:0,away:0};
 for(const e of events)if(e.goal)goals[e.side]++;
 if(goals.home!==match.score.home||goals.away!==match.score.away)throw new OpenFootError('event_score_mismatch');
 events.sort((a,b)=>a.clock-b.clock||a.id.localeCompare(b.id));
 const intervals=[],score={home:0,away:0};let previous=0;
 for(const clock of [...new Set([...events.filter(e=>e.goal).map(e=>e.clock),90])].sort((a,b)=>a-b)){
  if(clock>previous)intervals.push({from:previous,to:clock,homeGoals:score.home,awayGoals:score.away});
  for(const e of events.filter(e=>e.goal&&e.clock===clock))score[e.side]++;
  previous=clock;
 }
 const exposure={tied:0,homeLeading:0,awayLeading:0};
 for(const i of intervals)exposure[i.homeGoals===i.awayGoals?'tied':i.homeGoals>i.awayGoals?'homeLeading':'awayLeading']+=i.to-i.from;
 const states=Object.fromEntries(['home','away'].map(side=>[side,Object.fromEntries(['tied','leading','trailing','unclassified'].map(k=>[k,{openPlayXg:0,setPieceXg:0,nonPenaltyXg:0,shots:0}]))]));
 const redCards=events.filter(e=>e.red),firstRed=Math.min(91,...redCards.map(e=>e.clock));
 let ambiguousShots=0;
 for(const shot of xgPayload.data.shots){
  const side=teamName(shot.team)===teamName(match.homeTeam.name)?'home':'away',clock=Math.min(90,shot.minute);
  const same=events.filter(e=>e.clock===clock),scoring=same.filter(e=>e.goal&&e.side===side&&teamName(e.player)===teamName(shot.player));
  let interval=intervals.find(i=>i.from<=clock&&clock<i.to),ambiguous=same.length>0;
  if(shot.result==='Goal'&&scoring.length===1&&same.length===1){
   interval=intervals.find(i=>i.to===clock)||{homeGoals:0,awayGoals:0};ambiguous=false;
  }
  const state=ambiguous||!interval?'unclassified':interval.homeGoals===interval.awayGoals?'tied':((side==='home'?interval.homeGoals>interval.awayGoals:interval.awayGoals>interval.homeGoals)?'leading':'trailing');
  if(ambiguous)ambiguousShots++;
  const bucket=states[side][state];bucket.shots++;
  if(shot.situation==='Penalty')continue;
  if(['OpenPlay','FastBreak'].includes(shot.situation)){bucket.openPlayXg+=shot.xG;bucket.nonPenaltyXg+=shot.xG;}
  else if(['FromCorner','SetPiece','DirectFreekick'].includes(shot.situation)){bucket.setPieceXg+=shot.xG;bucket.nonPenaltyXg+=shot.xG;}
 }
 return {...observation,timeline:{complete:true,goals,redCards,intervals,exposure,elevenVelevenMinutes:Math.min(90,firstRed),ambiguousMinuteShots:ambiguousShots,scoreStateXg:states,
  resolution:'minute; ambiguous ordering remains unclassified; regulation-time exposure'},
  eventSources:eventPayload.meta.sources.map(({name,license,url})=>({name,license,url}))};
}
