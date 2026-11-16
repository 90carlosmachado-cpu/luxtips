/** Explicit risk policy. These gates are not fitted probabilities or confidence intervals. */
export const BIGODES_QUALITY_VERSION = 'bigodes-quality-v1';
const DAY = 86400000, EPS = 1e-10;
const finite = Number.isFinite;
const unit = value => finite(value) && value > 0 && value < 1;

/** Shared by the optimizer and publisher: a caller cannot bypass evidence with a large p. */
export function legQualityFailure(leg, policy, now) {
  if (!policy.requireQualityEvidence) return null;
  const probability = leg?.probability ?? leg?.probabilities?.[leg?.market];
  if (![probability, leg?.modelProbability, leg?.marketProbability].every(unit)) {
    return 'missing_probability_components';
  }
  if (Math.abs(probability - (leg.modelProbability + leg.marketProbability) / 2) > EPS) {
    return 'inconsistent_probability_components';
  }
  if (leg.marketProbability < policy.minMarketProbability - EPS) return 'market_probability_below_minimum';
  if (Math.abs(leg.modelProbability - leg.marketProbability) > policy.maxModelMarketGap + EPS) {
    return 'model_market_disagreement';
  }
  if (!finite(leg.referenceAt) || leg.referenceAt !== leg.quoteAt) return 'incoherent_reference_clock';
  const model = leg.model, evidence = model?.evidence;
  if (model?.quality?.eligible !== true || evidence?.version !== BIGODES_QUALITY_VERSION ||
      !['national_official', 'competition_roles'].includes(evidence?.scope)) return 'insufficient_model_evidence';
  if ((evidence.scope === 'national_official') !== [1,4,5,32,960].includes(leg.league)) return 'inconsistent_evidence_scope';
  if (!finite(model.cutoff) || model.cutoff > now || model.cutoff >= leg.kickoff ||
      now - model.cutoff >= policy.quoteMaxAge) return 'invalid_model_cutoff';
  const maxAge = evidence.scope === 'national_official' ? 180 : 90;
  for (const side of ['home', 'away']) {
    const sample = evidence[side];
    if (!Number.isSafeInteger(sample?.games) || sample.games < 8 || !finite(sample.weighted) ||
        sample.weighted < 4 || sample.weighted > sample.games + EPS || !finite(sample.lastAt) || sample.lastAt + 7200000 > model.cutoff ||
        model.cutoff - sample.lastAt > maxAge * DAY) return 'insufficient_model_evidence';
    if (evidence.scope === 'competition_roles' &&
        (!Number.isSafeInteger(sample.roleGames) || sample.roleGames < 3 || sample.roleGames > sample.games ||
         !finite(sample.roleWeighted) || sample.roleWeighted < 1 || sample.roleWeighted > sample.weighted + EPS)) return 'insufficient_role_evidence';
  }
  return null;
}
