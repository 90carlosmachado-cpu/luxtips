// Paired evaluation uses probabilities frozen before kickoff, never a later refit.
export function compareForecasts(forecasts) {
  const out = {
    n: 0,
    currentBrier: 0,
    baselineBrier: 0,
    currentLogLoss: 0,
    baselineLogLoss: 0,
  };
  for (const f of forecasts) {
    const base = f.prediction?.baselineProbabilities,
      p = f.prediction?.probabilities;
    const h = f.result?.home,
      a = f.result?.away;
    if (!base || !p || !Number.isInteger(h) || !Number.isInteger(a)) continue;
    const keys = ["H", "D", "A"];
    if (
      ![base, p].every(
        (q) =>
          keys.every((k) => Number.isFinite(q[k]) && q[k] >= 0 && q[k] <= 1) &&
          Math.abs(keys.reduce((s, k) => s + q[k], 0) - 1) < 1e-6,
      )
    )
      continue;
    const actual = h > a ? "H" : h === a ? "D" : "A";
    out.n++;
    for (const k of keys) {
      out.currentBrier += (p[k] - Number(k === actual)) ** 2;
      out.baselineBrier += (base[k] - Number(k === actual)) ** 2;
    }
    out.currentLogLoss -= Math.log(Math.max(1e-12, p[actual]));
    out.baselineLogLoss -= Math.log(Math.max(1e-12, base[actual]));
  }
  for (const k of Object.keys(out))
    if (k !== "n") out[k] = out.n ? out[k] / out.n : null;
  return out;
}
