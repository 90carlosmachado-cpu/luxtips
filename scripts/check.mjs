import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { patchedLegacy } from './legacy-hook.mjs';
async function visit(path) {
  for (const item of await readdir(path, { withFileTypes: true })) {
    const file = `${path}/${item.name}`;
    if (item.isDirectory()) await visit(file);
    else if (file.endsWith('.mjs')) {
      const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
    }
  }
}
for (const p of ['src', 'scripts', 'tests']) await visit(p);
const baseline = await readFile('recovered/worker.mjs', 'utf8');
const recovered = await readFile('src/legacy-worker.mjs', 'utf8');
assert.equal(recovered, patchedLegacy(baseline));
console.log('Sintaxe válida; apenas o hook OpenFoot autorizado difere do bundle recuperado.');
