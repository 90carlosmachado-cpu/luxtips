import fs from "node:fs";
import crypto from "node:crypto";
import {
  normalize,
  fit,
  predict,
  outcome,
  LABELS,
  wilson,
} from "../src/model.js";
const rows = fs
  .readdirSync("data")
  .filter((n) => n.startsWith("fixtures-"))
  .flatMap((n) => JSON.parse(fs.readFileSync("data/" + n)).response || [])
  .map(normalize)
  .filter((r) => r?.finished);
const unique = [...new Map(rows.map((r) => [r.id, r])).values()].sort(
  (a, b) => a.ts - b.ts,
);
const metric = (rs) => {
  const n = rs.length;
  if (!n) return null;
  let b = 0,
    log = 0;
  for (const r of rs) {
    b += (r.p - r.y) ** 2;
    log -=
      r.y * Math.log(Math.max(1e-9, r.p)) +
      (1 - r.y) * Math.log(Math.max(1e-9, 1 - r.p));
  }
  return {
    n,
    brier: b / n,
    logLoss: log / n,
    accuracy: rs.filter((r) => (r.p >= 0.5 ? 1 : 0) === r.y).length / n,
  };
};
function evaluate(opts, start, end) {
  const records = [],
    cache = new Map();
  for (const f of unique) {
    if (f.season < start || f.season > end) continue;
    const cutoff = Math.floor(f.ts / 86400000) * 86400000,
      key = f.league + ":" + cutoff;
    let s = cache.get(key);
    if (!s) {
      s = fit(
        unique.filter((r) => r.league === f.league),
        cutoff,
        opts,
      );
      cache.set(key, s);
    }
    const pred = predict(s, f);
    if (pred.sample < 12) continue;
    const base = predict({ ...s, teams: {} }, f);
    for (const [k, p] of Object.entries(pred.probabilities))
      records.push({
        id: f.id,
        league: f.league,
        season: f.season,
        ts: f.ts,
        k,
        p,
        y: outcome(k, f.hg, f.ag),
        base: base.probabilities[k],
      });
  }
  return records;
}
const options = [
  { halfLife: 180, prior: 8, eloWeight: 0 },
  { halfLife: 180, prior: 8, eloWeight: 0.15 },
  { halfLife: 365, prior: 8, eloWeight: 0 },
];
const devRecords = options.map((opts) => evaluate(opts, 2024, 2024));
const common = new Set(
  devRecords[0]
    .filter((r) => devRecords.every((rs) => rs.some((x) => x.id === r.id)))
    .map((r) => r.id),
);
const development = options.map((opts, i) => ({
  opts,
  ...metric(devRecords[i].filter((r) => common.has(r.id))),
}));
development.sort((a, b) => a.brier - b.brier);
const simplest = development.find(
  (x) => x.opts.halfLife === 180 && x.opts.eloWeight === 0,
);
const chosen =
  development[0].brier < simplest.brier - 0.001
    ? development[0].opts
    : simplest.opts;
console.log("development", development);
const records = evaluate(chosen, 2025, 2025),
  markets = {};
function paired(rs) {
  const ds = rs.map((r) => (r.base - r.y) ** 2 - (r.p - r.y) ** 2),
    n = ds.length,
    mean = ds.reduce((s, d) => s + d, 0) / Math.max(1, n),
    se = Math.sqrt(
      ds.reduce((s, d) => s + (d - mean) ** 2, 0) /
        Math.max(1, n - 1) /
        Math.max(1, n),
    );
  return { improvement: mean, interval: [mean - 1.96 * se, mean + 1.96 * se] };
}
for (const k of Object.keys(LABELS)) {
  const rs = records.filter((r) => r.k === k),
    m = metric(rs),
    baseline = metric(rs.map((r) => ({ ...r, p: r.base }))),
    bins = [];
  for (let i = 0; i < 10; i++) {
    const low = i / 10,
      high = (i + 1) / 10,
      b = rs.filter((r) => r.p >= low && r.p < high),
      n = b.length,
      w = b.reduce((s, r) => s + r.y, 0);
    bins.push({
      low,
      high,
      n,
      mean: n ? b.reduce((s, r) => s + r.p, 0) / n : null,
      rate: n ? w / n : null,
      interval: wilson(w, n),
    });
  }
  const ece =
    bins.reduce(
      (s, b) => s + b.n * Math.abs((b.rate || 0) - (b.mean || 0)),
      0,
    ) / Math.max(1, rs.length);
  // Global criterion is exploratory, not evidence of profitability. Confidence gate also checks bins.
  markets[k] = {
    ...m,
    baselineBrier: baseline?.brier,
    ece,
    comparison: paired(rs),
    enabled: m?.n >= 500 && paired(rs).interval[0] > 0 && ece <= 0.06,
    bins,
    byLeague: Object.fromEntries(
      [...new Set(rs.map((r) => r.league))].map((l) => [
        l,
        (() => {
          const subset = rs.filter((r) => r.league === l),
            m = metric(subset),
            c = paired(subset);
          return {
            ...m,
            comparison: c,
            enabled: m.n >= 100 && c.interval[0] > 0,
          };
        })(),
      ]),
    ),
  };
}
const result = {
  generatedAt: new Date().toISOString(),
  source: "API-Football, resultados regulamentares",
  datasetHash: crypto
    .createHash("sha256")
    .update(JSON.stringify(unique))
    .digest("hex"),
  matches: unique.length,
  holdoutMatches: new Set(records.map((r) => r.id)).size,
  training: "Época 2023; atualização diária com resultados anteriores ao corte",
  development: "Época 2024: escolha entre 3 configurações predefinidas",
  holdout:
    "Época 2025 (2025/26): avaliação após seleção; pesos atualizados só com passado",
  cutoff: "00:00 UTC do dia do jogo; exclui jogos sem 2h de antecedência",
  opts: chosen,
  developmentResults: development,
  markets,
  limitations: [
    "Validação retrospetiva com resultados recolhidos agora; correções posteriores da fonte não são observáveis.",
    "Sem odds históricas: não foi calculado ROI nem demonstrada vantagem sobre casas de apostas.",
    "Sem snapshots do modelo antigo: comparação direta não executada.",
    "Elo só é incluído se escolhido em desenvolvimento. Lesões, plantel, cantos e cartões não ajustam o modelo.",
    "As condições de seleção são exploratórias; requerem confirmação prospetiva. Intervalos normais de diferenças de Brier não corrigem dependência entre jogos nem comparações múltiplas.",
  ],
};
fs.writeFileSync("src/validation.json", JSON.stringify(result, null, 2));
fs.writeFileSync("data/holdout-records.json", JSON.stringify(records));
fs.writeFileSync("data/normalized.json", JSON.stringify(unique));
console.log(
  JSON.stringify(
    {
      matches: result.matches,
      holdout: result.holdoutMatches,
      chosen,
      markets: Object.fromEntries(
        Object.entries(markets).map(([k, v]) => [
          k,
          {
            n: v.n,
            brier: v.brier,
            baseline: v.baselineBrier,
            ece: v.ece,
            enabled: v.enabled,
          },
        ]),
      ),
    },
    null,
    2,
  ),
);
