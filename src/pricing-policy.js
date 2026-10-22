export const MIN_ODD = 1.25;
export const PRICING_VERSION = "verified-odds-1.25-v1";
export function quoteFor(g, market, now) {
  const q = g.odds?.[market];
  return q &&
    Number.isFinite(q.odd) &&
    q.odd >= MIN_ODD &&
    Number.isFinite(q.at) &&
    q.at <= now &&
    now - q.at < 6 * 3600000
    ? q
    : null;
}
export function pricedTip(g, tip, now) {
  if (!tip) return null;
  const q = quoteFor(g, tip.market, now);
  return {
    ...tip,
    odd: q?.odd ?? null,
    bookmaker: q?.bookmaker ?? null,
    oddsAt: q?.at ?? null,
    expectedValue: q ? tip.probability * q.odd - 1 : null,
    priceEligible: !!q,
    minimumMarketOdd: MIN_ODD,
    valueStatus: !q
      ? "Sem odd verificada de pelo menos 1,25."
      : tip.probability * q.odd > 1
        ? "Valor esperado positivo estimado; rentabilidade não demonstrada."
        : "A odd não oferece valor esperado positivo segundo o modelo.",
  };
}
export function applyPricing(g, now) {
  const out = {
    ...g,
    winnerTip: pricedTip(g, g.winnerTip, now),
    pricingPolicy: PRICING_VERSION,
  };
  if (g.displayTip) {
    const p = pricedTip(g, g.displayTip, now);
    if (p.priceEligible) out.displayTip = p;
    else delete out.displayTip;
  }
  return out;
}
