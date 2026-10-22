// Pre-match goal projections, not event/shot xG.
function marginal(mean) {
  if (!Number.isFinite(mean) || mean <= 0 || mean > 5)
    throw new RangeError("Invalid goal intensity");
  const p = [Math.exp(-mean)];
  for (let k = 1; k <= 30; k++) p.push((p[k - 1] * mean) / k);
  const sum = p.reduce((a, b) => a + b, 0);
  return p.map((x) => x / sum);
}
function interval(p) {
  let best;
  for (let lo = 0; lo < p.length; lo++) {
    let mass = 0;
    for (let hi = lo; hi < p.length; hi++) {
      mass += p[hi];
      if (mass >= 0.8) {
        if (
          !best ||
          hi - lo < best.high - best.low ||
          (hi - lo === best.high - best.low && mass > best.coverage)
        )
          best = { low: lo, high: hi, coverage: mass };
        break;
      }
    }
  }
  return best;
}
export function mixtureProjection(components) {
  if (
    !components.length ||
    components.some((c) => !Number.isFinite(c.weight) || c.weight < 0) ||
    Math.abs(components.reduce((s, c) => s + c.weight, 0) - 1) > 1e-10
  )
    throw new RangeError("Invalid mixture weights");
  const parts = components.map((c) => ({
    ...c,
    h: marginal(c.homeGoals),
    a: marginal(c.awayGoals),
  }));
  const home = Array(31).fill(0),
    away = Array(31).fill(0),
    scores = [];
  for (let h = 0; h < 31; h++)
    for (let a = 0; a < 31; a++) {
      const probability = parts.reduce(
        (s, c) => s + c.weight * c.h[h] * c.a[a],
        0,
      );
      home[h] += probability;
      away[a] += probability;
      scores.push({ home: h, away: a, probability });
    }
  scores.sort(
    (a, b) =>
      b.probability - a.probability || a.home - b.home || a.away - b.away,
  );
  return {
    version: "luxg-2",
    method: components.length > 1 ? "poisson-mixture" : "opponent-poisson",
    eventXg: false,
    topScores: scores.slice(0, 3),
    topThreeMass: scores.slice(0, 3).reduce((s, x) => s + x.probability, 0),
    goalRanges: {
      nominalCoverage: 0.8,
      home: interval(home),
      away: interval(away),
    },
  };
}
export function scoreProjection(homeGoals, awayGoals) {
  return mixtureProjection([{ weight: 1, homeGoals, awayGoals }]);
}
