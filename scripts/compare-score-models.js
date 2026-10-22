// Research-only Dixon-Coles low-score correction. No production weights changed.
import fs from "node:fs";
import { fit, predict } from "../src/model.js";
const rows = JSON.parse(fs.readFileSync("data/normalized.json"));
const validation = JSON.parse(fs.readFileSync("src/validation.json"));
const rhos = [0, -0.15, -0.1, -0.05, 0.05, 0.1, 0.15];
function probabilities(h, a, rho) {
  const hp = [Math.exp(-h)],
    ap = [Math.exp(-a)];
  for (let i = 1; i <= 22; i++) {
    hp[i] = (hp[i - 1] * h) / i;
    ap[i] = (ap[i - 1] * a) / i;
  }
  // Keep every corrected cell positive; correction preserves total mass.
  rho = Math.max(-0.99 / Math.max(h, a), Math.min(0.99 / (h * a), rho));
  const out = [0, 0, 0];
  let mass = 0;
  for (let i = 0; i < hp.length; i++)
    for (let j = 0; j < ap.length; j++) {
      const tau =
        i === 0 && j === 0
          ? 1 - h * a * rho
          : i === 0 && j === 1
            ? 1 + h * rho
            : i === 1 && j === 0
              ? 1 + a * rho
              : i === 1 && j === 1
                ? 1 - rho
                : 1;
      const p = hp[i] * ap[j] * tau;
      mass += p;
      out[i > j ? 0 : i === j ? 1 : 2] += p;
    }
  return out.map((p) => p / mass);
}
function evaluate(season) {
  const cache = new Map(),
    scores = rhos.map((rho) => ({ rho, n: 0, brier: 0, logLoss: 0, hits: 0 }));
  for (const f of rows) {
    if (f.season !== season) continue;
    const cutoff = Math.floor(f.ts / 86400000) * 86400000,
      key = f.league + ":" + cutoff;
    let state = cache.get(key);
    if (!state) {
      state = fit(
        rows.filter((r) => r.league === f.league),
        cutoff,
        validation.opts,
      );
      cache.set(key, state);
    }
    const pred = predict(state, f);
    if (pred.sample < 12) continue;
    const y = f.hg > f.ag ? 0 : f.hg === f.ag ? 1 : 2;
    for (const s of scores) {
      const p = probabilities(pred.homeGoals, pred.awayGoals, s.rho);
      s.n++;
      s.brier += p.reduce((sum, x, k) => sum + (x - Number(k === y)) ** 2, 0);
      s.logLoss -= Math.log(p[y]);
      s.hits += p.indexOf(Math.max(...p)) === y ? 1 : 0;
    }
  }
  return scores.map((s) => ({
    ...s,
    brier: s.brier / s.n,
    logLoss: s.logLoss / s.n,
    accuracy: s.hits / s.n,
  }));
}
const development = evaluate(2024);
const best = [...development].sort((a, b) => a.brier - b.brier)[0],
  base = development.find((s) => s.rho === 0);
const chosen = base.brier - best.brier >= 0.001 ? best.rho : 0;
const holdout = evaluate(2025);
const result = {
  scope:
    "Experiência separada; seleção do rho na época 2024, avaliação cronológica na época 2025. Brier multiclasse 1X2 (soma, não média). Não mede ROI, não reconstrói atrasos da API. Sem alteração automática do modelo de produção.",
  reference:
    "Dixon & Coles (1997), doi:10.1111/1467-9876.00065; apenas correção de quatro resultados baixos, não reprodução integral do artigo.",
  rule: "7 valores predefinidos; exige melhoria de 0.001 de Brier em desenvolvimento para justificar complexidade.",
  development,
  chosen,
  holdout,
};
fs.writeFileSync(
  "src/score-model-research.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
