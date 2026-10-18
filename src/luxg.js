// Pre-match goal projections, not event/shot xG. No experimental fit is active.
export function scoreProjection(homeGoals, awayGoals) {
  if (
    ![homeGoals, awayGoals].every((x) => Number.isFinite(x) && x > 0 && x <= 5)
  )
    throw new RangeError("Invalid goal intensity");
  const marginal = (mean) => {
    const p = [Math.exp(-mean)];
    for (let k = 1; k <= 30; k++) p.push((p[k - 1] * mean) / k);
    const sum = p.reduce((a, b) => a + b, 0);
    return p.map((x) => x / sum);
  };
  const home = marginal(homeGoals),
    away = marginal(awayGoals);
  const scores = [];
  for (let h = 0; h < home.length; h++)
    for (let a = 0; a < away.length; a++)
      scores.push({ home: h, away: a, probability: home[h] * away[a] });
  scores.sort(
    (a, b) =>
      b.probability - a.probability || a.home - b.home || a.away - b.away,
  );
  const interval = (p) => {
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
  };
  return {
    version: "luxg-1",
    method: "opponent-poisson",
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
