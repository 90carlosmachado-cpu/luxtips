import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.mjs';
import legacy from '../src/legacy-worker.mjs';
test('wrapper preserves the generated HTML and non-live routes', async () => {
  for (const path of ['/', '/index.html', '/api/validation', '/missing']) {
    const req = new Request('https://luxtips.test' + path);
    const a = await legacy.fetch(req, {}, {}), b = await worker.fetch(req, {}, {});
    assert.equal(a.status, b.status);
    assert.deepEqual([...a.headers], [...b.headers]);
    assert.equal(await a.text(), await b.text());
  }
});
test('new status endpoint is protected and its disabled state needs no database', async () => {
  const req = new Request('https://luxtips.test/api/admin/openfoot');
  assert.equal((await worker.fetch(req, { ADMIN_TOKEN: 'admin' }, {})).status, 401);
  const authenticated = new Request(req, { headers: { Authorization: 'Bearer admin' } });
  const r = await worker.fetch(authenticated, { ADMIN_TOKEN: 'admin', OPENFOOT_API_KEY: 'secret' }, {});
  assert.deepEqual(await r.json(), { mode: 'disabled', configured: true });
});
