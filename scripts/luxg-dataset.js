import fs from "node:fs";
import crypto from "node:crypto";
import { fit, predict } from "../src/model.js";
import { luxgFeatures, FEATURE_NAMES } from "../src/luxg-features.js";
const rows = JSON.parse(fs.readFileSync("data/normalized.json")).sort(
  (a, b) => a.ts - b.ts,
);
const opts = JSON.parse(fs.readFileSync("src/validation.json")).opts;
const cache = new Map(),
  out = [];
for (const f of rows) {
  const cutoff = Math.floor(f.ts / 86400000) * 86400000,
    key = f.league + ":" + cutoff;
  let state = cache.get(key);
  if (!state) {
    state = fit(
      rows.filter((r) => r.league === f.league),
      cutoff,
      opts,
    );
    cache.set(key, state);
  }
  const p = predict(state, f);
  if (p.sample < 5) continue;
  out.push({
    id: f.id,
    ts: f.ts,
    league: f.league,
    season: f.season,
    cutoff,
    sample: p.sample,
    hg: f.hg,
    ag: f.ag,
    base: [p.homeGoals, p.awayGoals],
    features: luxgFeatures(state, f, p.homeGoals, p.awayGoals),
  });
}
fs.writeFileSync(
  "data/luxg-training.json",
  JSON.stringify({
    datasetHash: crypto
      .createHash("sha256")
      .update(JSON.stringify(rows))
      .digest("hex"),
    opts,
    features: FEATURE_NAMES,
    rows: out,
  }),
);
console.log(
  "Prequential rows",
  out.length,
  "evaluation sample>=12",
  out.filter((r) => r.sample >= 12).length,
);
