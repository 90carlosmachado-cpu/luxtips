import { fit as baseFit, predict as basePredict } from "./model.js";
import { mixtureProjection } from "./luxg.js";
import config from "./winner-config.json" with { type: "json" };
import { extraGoalMarkets } from "./market-probabilities.js";
export const VERSION = config.version;
export function fit(history, cutoff) {
  return config.components.map((c) => ({
    weight: c.weight,
    state: baseFit(history, cutoff, c),
  }));
}
export function predict(states, fixture) {
  const components = states.map((c) => ({
    weight: c.weight,
    prediction: basePredict(c.state, fixture),
  }));
  // The medium-term component supplies conservative sample eligibility and descriptive stats.
  const base = components[0].prediction;
  const probabilities = Object.fromEntries(
    Object.keys(base.probabilities).map((k) => [
      k,
      components.reduce(
        (s, c) => s + c.weight * c.prediction.probabilities[k],
        0,
      ),
    ]),
  );
  const goals = components.map((c) => ({
    weight: c.weight,
    homeGoals: c.prediction.homeGoals,
    awayGoals: c.prediction.awayGoals,
  }));
  return {
    ...base,
    version: VERSION,
    baselineProbabilities: base.probabilities,
    probabilities: { ...probabilities, ...extraGoalMarkets(goals) },
    homeGoals: goals.reduce((s, c) => s + c.weight * c.homeGoals, 0),
    awayGoals: goals.reduce((s, c) => s + c.weight * c.awayGoals, 0),
    luxg: mixtureProjection(goals),
    components: goals,
    modelEvidence: config.status,
    risks: [
      ...new Set(components.flatMap((c) => c.prediction.risks)),
      "Combinação validada retrospetivamente; melhoria futura ainda por confirmar.",
    ],
  };
}
