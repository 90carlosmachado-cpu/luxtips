export const BOOKMAKER='Betano';
export const BETANO_MAX_AGE=21600000;
export function providerSelection(code){
 const winner={H:'Home',A:'Away','1':'Home','2':'Away'}[code];if(winner)return {market:'Match Winner',selection:winner};
 const dc={'1X':'Home/Draw',X2:'Draw/Away'}[code];if(dc)return {market:'Double Chance',selection:dc};
 const goals={O15:'Over 1.5',O25:'Over 2.5',O35:'Over 3.5'}[code];if(goals)return {market:'Goals Over/Under',selection:goals};
 const both={BY:'Yes',BN:'No'}[code];return both?{market:'Both Teams Score',selection:both}:null;
}
export async function betanoQuote(db,fixtureId,kickoff,code,now=Date.now()){
 const selection=providerSelection(code);if(!selection)return null;
 const row=await db.prepare(`SELECT odd,provider_at,observed_at FROM openfoot_market_quotes
 WHERE fixture_id=? AND kickoff=? AND bookmaker='Betano' AND market=? AND selection=?
 AND odd>1 AND provider_at<=observed_at AND observed_at<=? AND observed_at<?
 ORDER BY provider_at DESC,observed_at DESC LIMIT 1`).bind(fixtureId,kickoff,selection.market,selection.selection,now,kickoff).first();
 if(!row||!Number.isFinite(row.odd))return null;
 return {odd:row.odd,bookmaker:BOOKMAKER,at:row.provider_at,observedAt:row.observed_at,status:now>=kickoff?'prematch_closed':now-row.provider_at>=BETANO_MAX_AGE?'quote_expired':'ready'};
}
export async function withFootballBetano(db,game,now){
 const f=game.fixture;if(!f)return game;const next={...game};let currentQuote=null;
 for(const key of ['displayTip','winnerTip','recommendation']){const p=game[key];if(!p||!['H','A'].includes(p.market))continue;
  const quote=await betanoQuote(db,f.id,f.ts,p.market,now);currentQuote=quote;
  next[key]={...p,registeredQuote:p.registeredQuote||{odd:p.odd,bookmaker:p.bookmaker,at:p.oddsAt},odd:quote?.odd??null,bookmaker:BOOKMAKER,oddsAt:quote?.at??null,quote:quote||null,quoteStatus:quote?.status||'market_unavailable',expectedValue:quote&&Number.isFinite(p.probability)?p.probability*quote.odd-1:null};
  if(next[key].assessment)next[key].assessment={...next[key].assessment,odd:quote?.odd??null,expectedReturn:quote&&Number.isFinite(p.assessment.conservativeProbability)?quote.odd*p.assessment.conservativeProbability-1:null};
 }
 return {...next,priceBookmaker:BOOKMAKER,quoteStale:currentQuote?.status==='quote_expired',liveQuoteStatus:currentQuote?.status||'market_unavailable'};
}
export async function withTicketBetano(db,ticket,now){
 const legs=[];for(const l of ticket.legs)legs.push({...l,currentQuote:await betanoQuote(db,l.fixtureId,l.kickoff,l.market,now)});
 const complete=legs.every(l=>l.currentQuote),expired=legs.some(l=>l.currentQuote?.status==='quote_expired');
 return {...ticket,legs,displayBookmaker:BOOKMAKER,currentOdd:complete?legs.reduce((p,l)=>p*l.currentQuote.odd,1):null,currentOddStatus:!complete?'market_unavailable':expired?'quote_expired':legs.some(l=>l.kickoff<=now)?'prematch_closed':'ready'};
}
