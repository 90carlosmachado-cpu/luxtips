import fs from "node:fs";
import { fit, grid } from "../src/model.js";
const all = JSON.parse(fs.readFileSync("data/normalized.json"));
const prior = JSON.parse(fs.readFileSync("data/luxg-training.json"));
const ids = new Set(prior.rows.filter((r) => r.sample >= 12).map((r) => r.id));
const options = [
  { halfLife: 90, prior: 8 },
  { halfLife: 180, prior: 8 },
  { halfLife: 365, prior: 8 },
  { halfLife: 180, prior: 16 },
];
const cache = new Map(),
  rows = [];
const clip = (x) => Math.max(0.15, Math.min(5, x));
for (const f of all.filter((r) => ids.has(r.id)).sort((a, b) => a.ts - b.ts)) {
  const cutoff = Math.floor(f.ts / 86400000) * 86400000,
    key = f.league + ":" + cutoff;
  let states = cache.get(key);
  if (!states) {
    states = options.map((o) =>
      fit(
        all.filter((r) => r.league === f.league),
        cutoff,
        o,
      ),
    );
    cache.set(key, states);
  }
  rows.push({
    id: f.id,
    base: states.map((s) => [
      clip(
        s.bh * (s.teams[f.home]?.attack || 1) * (s.teams[f.away]?.defense || 1),
      ),
      clip(
        s.ba * (s.teams[f.away]?.attack || 1) * (s.teams[f.home]?.defense || 1),
      ),
    ]),
  });
}
fs.writeFileSync(
  "data/winner-multiscale.json",
  JSON.stringify({ datasetHash: prior.datasetHash, options, rows }),
);
console.log(rows.length + " multiscale rows");
