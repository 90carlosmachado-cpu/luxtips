// Fixed 1X2 decision rule: argmax(H,D,A), then at most three per Lisbon day.
// Retrospective selector evaluation; no historical API freshness/odds simulation.
import fs from "node:fs";
import { winnerTip, VERSION, wilson } from "../src/model.js";
const records = JSON.parse(fs.readFileSync("data/holdout-records.json"));
const fixtures = new Map(
  JSON.parse(fs.readFileSync("data/normalized.json")).map((f) => [f.id, f]),
);
const validation = JSON.parse(fs.readFileSync("src/validation.json"));
const grouped = new Map();
for (const r of records) {
  if (!grouped.has(r.id)) grouped.set(r.id, {});
  grouped.get(r.id)[r.k] = r;
}
const tips = [];
for (const [id, rs] of grouped) {
  const f = fixtures.get(id),
    probabilities = Object.fromEntries(
      Object.entries(rs).map(([k, r]) => [k, r.p]),
    );
  const pred = {
    sample: 12,
    league: f.league,
    homeName: f.homeName,
    awayName: f.awayName,
    homeGoals: 0,
    awayGoals: 0,
    probabilities,
  };
  const tip = winnerTip(
    pred,
    validation,
    {},
    { now: f.ts, sourceUpdatedAt: f.ts },
  );
  if (tip)
    tips.push({
      id,
      league: f.league,
      ts: f.ts,
      day: new Date(f.ts).toLocaleDateString("sv-SE", {
        timeZone: "Europe/Lisbon",
      }),
      p: tip.probability,
      y: rs[tip.market].y,
      base: rs[tip.market].base,
      market: tip.market,
      majority: tip.majority,
    });
}
const metric = (rows) => {
  const n = rows.length;
  if (!n) return { n: 0 };
  const mean = (f) => rows.reduce((s, r) => s + f(r), 0) / n;
  const bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 }));
  for (const r of rows) {
    const b = bins[Math.min(9, Math.floor(r.p * 10))];
    b.n++;
    b.p += r.p;
    b.y += r.y;
  }
  return {
    interval: wilson(
      rows.reduce((s, r) => s + r.y, 0),
      n,
    ),
    ece: bins.reduce((s, b) => s + Math.abs(b.p - b.y), 0) / n,
    n,
    wins: rows.reduce((s, r) => s + r.y, 0),
    hitRate: mean((r) => r.y),
    meanProbability: mean((r) => r.p),
    brier: mean((r) => (r.p - r.y) ** 2),
    logLoss: mean((r) => -r.y * Math.log(r.p) - (1 - r.y) * Math.log(1 - r.p)),
    baselineBrierSameEvents: mean((r) => (r.base - r.y) ** 2),
    calibrationGap: Math.abs(mean((r) => r.p) - mean((r) => r.y)),
  };
};
const byDay = new Map();
for (const t of tips.sort((a, b) => b.p - a.p)) {
  if (!byDay.has(t.day)) byDay.set(t.day, []);
  if (byDay.get(t.day).length < 3) byDay.get(t.day).push(t);
}
const ranked = [...byDay.values()].flat();
const report = {
  version: VERSION,
  datasetHash: validation.datasetHash,
  scope:
    "Avaliação retrospetiva do seletor de vencedor nos jogos da época 2025 já avaliados. Probabilidades calculadas cronologicamente no backtest original; sem novo treino nem ajuste dos pesos. Não é novo período independente. A recolha e atrasos da API não são reproduzidos; sem odds históricas, ROI e valor não avaliados.",
  rule: "Maior probabilidade entre casa/empate/fora; só escolhe equipa se superar as outras duas opções. Até 3 por dia de Lisboa, ordenados por probabilidade, sem filtro de odd nem limiar de 65%. Histórico mínimo de 12 jogos efetivos já aplicado no conjunto original.",
  all: metric(tips),
  topThreePerDay: metric(ranked),
  majority: metric(ranked.filter((r) => r.majority)),
  relative: metric(ranked.filter((r) => !r.majority)),
  byLeague: Object.fromEntries(
    [...new Set(ranked.map((t) => t.league))].map((l) => [
      l,
      metric(ranked.filter((r) => r.league === l)),
    ]),
  ),
};
fs.writeFileSync(
  "src/winner-review.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
