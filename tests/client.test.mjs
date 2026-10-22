import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenFootClient, boundedJson } from '../src/openfoot/client.mjs';
const page = (items, next = null, total = items.length) => ({ data: items, meta: { total_count: total, pagination: { limit: 100, next_cursor: next }, scope: { partial: false }, unavailable: [] } });
const match = id => ({ id, competitionId: 'comp_premier_league_eng', season: '2025/26' });
const reply = data => Response.json(data);

test('paginates authenticated history and keeps the credential in its header only', async () => {
  const calls = [];
  const c = createOpenFootClient({ key: 'test-secret', fetcher: async (url, init) => {
    calls.push({ url, init });
    return reply(calls.length === 1 ? page([match('one')], 'opaque', 2) : page([match('two')], null, 2));
  } });
  assert.deepEqual((await c.allMatches('comp_premier_league_eng', '2025/26')).map(m => m.id), ['one','two']);
  assert.equal(new URL(calls[1].url).searchParams.get('cursor'), 'opaque');
  for (const r of calls) {
    assert.equal(r.init.headers.Authorization, 'Bearer test-secret');
    assert.equal(r.init.redirect, 'manual');
    assert.equal(r.url.includes('test-secret'), false);
  }
});

test('rejects previews, truncated totals and mismatched competitions', async t => {
  const incomplete = page([match('one')], null, 2);
  const preview = { ...page([match('one')]), meta: { ...page([]).meta, preview_limit: 5 } };
  const wrong = page([{ ...match('one'), competitionId: 'other' }]);
  for (const [name, p] of [['total', incomplete], ['preview', preview], ['identity', wrong]]) await t.test(name, async () => {
    const c = createOpenFootClient({ key: 'x', fetcher: async () => reply(p) });
    await assert.rejects(c.allMatches('comp_premier_league_eng', '2025/26'));
  });
});

test('rejects repeated cursors and duplicate matches rather than completing the import', async () => {
  let n = 0;
  const c = createOpenFootClient({ key: 'x', fetcher: async () => reply(page([match(String(++n))], 'same', 8)) });
  await assert.rejects(c.allMatches('comp_premier_league_eng', '2025/26'), { code: 'pagination_loop' });
  let count = 0;
  const duplicate = createOpenFootClient({ key: 'x', fetcher: async () => reply(page([match('one')], ++count === 1 ? 'next' : null, 2)) });
  await assert.rejects(duplicate.allMatches('comp_premier_league_eng', '2025/26'), { code: 'duplicate_match' });
});

test('stops after a rate limit without leaking upstream messages', async () => {
  let calls = 0;
  const c = createOpenFootClient({ key: 'sensitive', clock: () => 1000, fetcher: async () => {
    calls++; return new Response('sensitive account details', { status: 429, headers: { 'Retry-After': '120' } });
  } });
  await assert.rejects(c.get('/v1/competitions'), { code: 'rate_limit', retryAfter: 121000 });
  await assert.rejects(c.get('/v1/competitions'), { code: 'rate_limit_cooldown' });
  assert.equal(calls, 1);
});

test('blocks redirects/other origins and enforces a request budget', async () => {
  let calls = 0;
  const c = createOpenFootClient({ key: 'x', maximumRequests: 1, fetcher: async () => { calls++; return reply({ data: [] }); } });
  await assert.rejects(c.get('https://attacker.test/v1/competitions'), { code: 'invalid_path' });
  await assert.rejects(c.get('/v1/../../other'), { code: 'invalid_path' });
  await c.get('/v1/competitions');
  await assert.rejects(c.get('/v1/competitions'), { code: 'run_budget' });
  assert.equal(calls, 1);
});

test('bounds response streams even without Content-Length', async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(100)); controller.close(); } });
  await assert.rejects(boundedJson(new Response(stream), 20), { code: 'payload_too_large' });
  await assert.rejects(boundedJson(new Response('<html>')), { code: 'invalid_json' });
});
