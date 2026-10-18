// Additional goal markets from the frozen convex Poisson mixture, not averaged means.
export function extraGoalMarkets(components) {
  if (
    !Array.isArray(components) ||
    !components.length ||
    components.some(
      (c) =>
        !Number.isFinite(c.weight) ||
        c.weight < 0 ||
        ![c.homeGoals, c.awayGoals].every(
          (x) => Number.isFinite(x) && x > 0 && x <= 5,
        ),
    ) ||
    Math.abs(components.reduce((s, c) => s + c.weight, 0) - 1) > 1e-10
  )
    return {};
  const pmf = (mean) => {
    const p = [Math.exp(-mean)];
    for (let n = 1; n <= 30; n++) p.push((p[n - 1] * mean) / n);
    const sum = p.reduce((a, b) => a + b, 0);
    return p.map((x) => x / sum);
  };
  const out = Object.fromEntries(
    [
      "HO05",
      "AO05",
      "HO15",
      "AO15",
      "O05",
      "U45",
      "HU15",
      "AU15",
      "HU25",
      "AU25",
      "HAP15",
      "AAP15",
    ].map((k) => [k, 0]),
  );
  for (const c of components) {
    const h = pmf(c.homeGoals),
      a = pmf(c.awayGoals),
      total = pmf(c.homeGoals + c.awayGoals);
    const cdf = (p) =>
        p.map((_, i) => p.slice(0, i + 1).reduce((s, x) => s + x, 0)),
      hc = cdf(h),
      ac = cdf(a);
    const p = {
      HO05: 1 - h[0],
      AO05: 1 - a[0],
      HO15: 1 - hc[1],
      AO15: 1 - ac[1],
      O05: 1 - h[0] * a[0],
      U45: total.slice(0, 5).reduce((s, x) => s + x, 0),
      HU15: hc[1],
      AU15: ac[1],
      HU25: hc[2],
      AU25: ac[2],
      HAP15: h.reduce((s, x, i) => s + x * ac[Math.min(30, i + 1)], 0),
      AAP15: a.reduce((s, x, i) => s + x * hc[Math.min(30, i + 1)], 0),
    };
    for (const k of Object.keys(out)) out[k] += c.weight * p[k];
  }
  return out;
}
export function marketProbabilities(prediction) {
  return {
    ...prediction.probabilities,
    ...extraGoalMarkets(prediction.components),
  };
}
export function marketLabel(market, fixture) {
  return {
    HX: `${fixture.homeName} ou empate`,
    XA: `${fixture.awayName} ou empate`,
    O05: "Mais de 0,5 golos",
    U45: "Menos de 4,5 golos",
    HU15: `${fixture.homeName} marca menos de 2 golos`,
    AU15: `${fixture.awayName} marca menos de 2 golos`,
    HU25: `${fixture.homeName} marca menos de 3 golos`,
    AU25: `${fixture.awayName} marca menos de 3 golos`,
    HAP15: `${fixture.homeName} — handicap +1,5`,
    AAP15: `${fixture.awayName} — handicap +1,5`,
    O15: "Mais de 1,5 golos",
    U15: "Menos de 1,5 golos",
    O25: "Mais de 2,5 golos",
    U25: "Menos de 2,5 golos",
    O35: "Mais de 3,5 golos",
    U35: "Menos de 3,5 golos",
    BY: "Ambas marcam",
    BN: "Ambas marcam — Não",
    HO05: `${fixture.homeName} marca pelo menos 1 golo`,
    AO05: `${fixture.awayName} marca pelo menos 1 golo`,
    HO15: `${fixture.homeName} marca pelo menos 2 golos`,
    AO15: `${fixture.awayName} marca pelo menos 2 golos`,
  }[market];
}
