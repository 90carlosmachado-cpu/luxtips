import test from "node:test";
import assert from "node:assert/strict";
import { quoteFor, applyPricing } from "../src/pricing-policy.js";
import { chooseDailyMarkets } from "../src/daily-markets.js";
import worker from "../dist/worker.js";
import { database } from "./db.js";
const now = Date.parse("2026-10-18T08:00:00Z");
function game() {
  return {
    fixture: { id: 1, ts: now + 3600000, status: "NS", finished: false },
    prediction: {
      probabilities: { H: 0.6, D: 0.2, A: 0.2, HX: 0.8, O05: 0.99 },
    },
    winnerTip: {
      market: "H",
      probability: 0.6,
      majority: true,
      sourceUpdatedAt: now,
    },
    odds: {
      H: { odd: 1.8, at: now, bookmaker: "A" },
      HX: { odd: 1.25, at: now, bookmaker: "A" },
      O05: { odd: 1.04, at: now, bookmaker: "A" },
    },
  };
}
test("1.25 inclusive: lower, absent, expired, future and nonnumeric prices never qualify", () => {
  const g = game();
  assert.equal(quoteFor(g, "HX", now).odd, 1.25);
  assert.equal(quoteFor(g, "O05", now), null);
  for (const q of [
    undefined,
    { odd: 1.2499, at: now },
    { odd: 1.5, at: now - 6 * 3600000 },
    { odd: 1.5, at: now + 1 },
    { odd: "1.5", at: now },
  ]) {
    g.odds.H = q;
    assert.equal(quoteFor(g, "H", now), null);
  }
});
test("a more probable low-priced market loses to a qualifying one; no unpriced fallback", () => {
  const g = game();
  assert.equal(chooseDailyMarkets([g], now)[0].market, "HX");
  g.odds.HX.odd = 1.24;
  assert.deepEqual(chooseDailyMarkets([g], now), []);
  g.odds.H.odd = 1.2;
  assert.equal(applyPricing(g, now).winnerTip.priceEligible, false);
});
test("expired alternative is removed, preserving a qualifying winner and the original record", () => {
  const g = game();
  g.displayTip = { market: "O05", probability: 0.99 };
  const copy = JSON.stringify(g),
    p = applyPricing(g, now);
  assert.equal(p.displayTip, undefined);
  assert.equal(p.winnerTip.odd, 1.8);
  assert.equal(JSON.stringify(g), copy);
});
test("public API marks current price validation pending rather than applying the unpriced backtest", async () => {
  const res = await worker.fetch(
    new Request("https://test/api/validation"),
    { DB: database() },
    { waitUntil() {} },
  );
  const d = await res.json();
  assert.equal(d.pricePolicy.minimumOdd, 1.25);
  assert.equal(d.pricePolicy.historicalValidation, null);
  assert.equal(d.marketExpansion.cap3MarketImpact.candidate.n, 459);
});
