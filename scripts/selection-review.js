// Retrospective policy review, not a new untouched holdout or ROI backtest.
import fs from "node:fs";
import { select, VERSION, outcome } from "../src/model.js";
const validation = JSON.parse(fs.readFileSync("src/validation.json"));
const records = JSON.parse(fs.readFileSync("data/holdout-records.json"));
const fixtures = new Map(
  JSON.parse(fs.readFileSync("data/normalized.json")).map((f) => [f.id, f]),
);
const grouped = new Map();
for (const r of records) {
  if (!grouped.has(r.id)) grouped.set(r.id, {});
  grouped.get(r.id)[r.k] = r.p;
}
const stats = { previous: [], favorites: [] };
for (const [id, probabilities] of grouped) {
  const f = fixtures.get(id),
    pred = {
      sample: 12,
      league: f.league,
      homeName: f.homeName,
      awayName: f.awayName,
      homeGoals: 0,
      awayGoals: 0,
      probabilities,
    };
  // Previous selector: original 10-point calibration bin and probability ranking.
  const candidates = Object.entries(probabilities)
    .filter(([k, p]) => {
      const v = validation.markets[k],
        b = v?.bins.find((b) => p >= b.low && p < b.high);
      return (
        v?.enabled &&
        v.byLeague?.[f.league]?.enabled &&
        b?.n >= 100 &&
        Math.abs(b.rate - b.mean) <= 0.08 &&
        p >= 0.65
      );
    })
    .sort((a, b) => b[1] - a[1]);
  const previous = candidates[0],
    next = select(pred, validation, {}, f.ts);
  if (previous)
    stats.previous.push({
      market: previous[0],
      p: previous[1],
      y: outcome(previous[0], f.hg, f.ag),
    });
  if (next)
    stats.favorites.push({
      market: next.market,
      p: next.probability,
      y: outcome(next.market, f.hg, f.ag),
    });
}
const summary = (rows) => {
  const n = rows.length,
    wins = rows.reduce((s, r) => s + r.y, 0);
  return {
    n,
    wins,
    hitRate: n ? wins / n : null,
    meanProbability: n ? rows.reduce((s, r) => s + r.p, 0) / n : null,
    brier: n ? rows.reduce((s, r) => s + (r.p - r.y) ** 2, 0) / n : null,
    logLoss: n
      ? rows.reduce(
          (s, r) => s - r.y * Math.log(r.p) - (1 - r.y) * Math.log(1 - r.p),
          0,
        ) / n
      : null,
    byMarket: Object.fromEntries(
      [...new Set(rows.map((r) => r.market))].map((k) => {
        const rs = rows.filter((r) => r.market === k);
        return [k, { n: rs.length, wins: rs.reduce((s, r) => s + r.y, 0) }];
      }),
    ),
  };
};
const report = {
  version: VERSION,
  datasetHash: validation.datasetHash,
  scope:
    "Retrospetiva da política de seleção sobre os 1835 jogos previamente avaliados; os filtros de elegibilidade usam este mesmo período. Não é teste independente, nem validação prospetiva. Sem odds históricas; valor e ROI não avaliados. A amostra efetiva mínima já foi aplicada ao gerar holdout-records.",
  previous: summary(stats.previous),
  favorites: summary(stats.favorites),
};
fs.writeFileSync(
  "src/selection-review.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
