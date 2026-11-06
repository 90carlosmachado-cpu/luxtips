export const QUOTE_MAX_AGE=6*3600000;
export function validWinnerQuote(card,now=Date.now()) {
  const a=card.winnerAnalysis,q=a?.quote,f=card.fixture;
  return !!(f && f.ts>now && ['ready','quote_expired','awaiting_recalculation'].includes(a?.quoteStatus) && q &&
    typeof q.odd==='number' && Number.isFinite(q.odd) && q.odd>=1.20 &&
    typeof q.bookmaker==='string' && q.bookmaker.trim() &&
    Number.isFinite(q.at) && Number.isFinite(q.observedAt) &&
    q.at<=q.observedAt && q.observedAt<=now);
}
export function filterWinnerAnalyses(body,now=Date.now()) {
  return {...body,winnerAnalyses:(body.winnerAnalyses||[]).filter(g=>validWinnerQuote(g,now))};
}
