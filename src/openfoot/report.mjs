import { SHADOW_VERSION } from './shadow.mjs';
const scored = (p, outcome) => {
  const values = ['H','D','A'].map(k => p?.[k]);
  if (!values.every(x => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1) || Math.abs(values.reduce((s,x) => s+x,0)-1)>1e-6) return null;
  return { brier: ['H','D','A'].reduce((s,k) => s + (p[k] - Number(k === outcome)) ** 2, 0),
    logLoss: -Math.log(Math.max(1e-12, p[outcome])) };
};

export function compareShadow(rows) {
  const groups = new Map();
  for (const row of rows) {
    const { fixture, candidate, baseline } = row.data;
    const current = row.current;
    if (!current?.finished || current.status !== 'FT' || current.id !== fixture.id || current.ts !== fixture.ts ||
        current.home !== fixture.home || current.away !== fixture.away ||
        !Number.isInteger(current.hg) || !Number.isInteger(current.ag) ||
        row.createdAt >= fixture.ts || !Number.isFinite(row.createdAt) ||
        candidate?.cutoff > row.createdAt || !Number.isFinite(candidate?.cutoff) ||
        !Number.isFinite(baseline?.cutoff) || baseline.cutoff > row.createdAt) continue;
    const outcome = current.hg > current.ag ? 'H' : current.hg < current.ag ? 'A' : 'D';
    const original = scored(baseline?.probabilities, outcome), control = scored(candidate.controlledBaseline?.probabilities, outcome), experiment = scored(candidate.probabilities, outcome);
    if (!original || !control || !experiment) continue;
    for (const key of ['all', String(fixture.league)]) {
      if (!groups.has(key)) groups.set(key, { n: 0, deployed: { brier: 0, logLoss: 0 }, control: { brier: 0, logLoss: 0 }, xg: { brier: 0, logLoss: 0 } });
      const g = groups.get(key); g.n++;
      for (const [name,value] of [['deployed',original],['control',control],['xg',experiment]]) {
        g[name].brier += value.brier; g[name].logLoss += value.logLoss;
      }
    }
  }
  for (const g of groups.values()) {
    for (const name of ['deployed','control','xg']) { g[name].brier /= g.n; g[name].logLoss /= g.n; }
    g.logLossImprovementVsControl = g.control.logLoss - g.xg.logLoss;
    g.evidence = 'descriptive-only; no automatic promotion or profitability claim';
  }
  return { scope: 'paired-prospective-forecasts-only', groups: Object.fromEntries(groups),
    promotionEligible: false, profitabilityEvaluated: false };
}

export async function shadowReport(db) {
  const rows = await db.prepare('SELECT s.created_at,s.data,f.data current FROM openfoot_shadow s JOIN fixtures f ON f.id=s.fixture_id WHERE f.finished=1 AND s.version=? ORDER BY s.kickoff LIMIT 5000').bind(SHADOW_VERSION).all();
  return compareShadow(rows.results.map(r => ({ createdAt: r.created_at, data: JSON.parse(r.data), current: JSON.parse(r.current) })));
}
