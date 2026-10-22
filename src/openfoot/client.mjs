const BASE = 'https://openfootapi.com';
export class OpenFootError extends Error {
  constructor(code, status = 0, retryAfter = null) {
    super(code);
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

// Bound the stream too: Content-Length is optional and may be incorrect.
export async function boundedJson(response, maximumBytes = 4_000_000) {
  if (Number(response.headers.get('content-length') || 0) > maximumBytes) {
    await response.body?.cancel();
    throw new OpenFootError('payload_too_large');
  }
  if (!response.body) throw new OpenFootError('empty_response');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new OpenFootError('payload_too_large');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new OpenFootError('invalid_json'); }
}

export function createOpenFootClient({ key, fetcher = fetch, reserve = async () => true,
  clock = Date.now, maximumRequests = 20, timeoutMs = 20_000 } = {}) {
  let requests = 0;
  let cooldownUntil = 0;
  async function get(path) {
    if (!key || !key.trim()) throw new OpenFootError('missing_key');
    // Never send Authorization to a caller-supplied origin or follow redirects.
    if (typeof path !== 'string' || !path.startsWith('/v1/') || /[\\\r\n#]/.test(path)) {
      throw new OpenFootError('invalid_path');
    }
    const url = new URL(path, BASE);
    if (url.origin !== BASE || !/^\/v1\/(competitions|account\/quota|matches(?:\/[^/]+\/(?:xg|events))?)$/.test(url.pathname)) {
      throw new OpenFootError('invalid_path');
    }
    if (clock() < cooldownUntil) throw new OpenFootError('rate_limit_cooldown', 429);
    if (requests >= maximumRequests) throw new OpenFootError('run_budget');
    if (!await reserve(clock(), path)) throw new OpenFootError('daily_budget');
    requests++;
    let r;
    try {
      r = await fetcher(url.href, {
        headers: { Authorization: `Bearer ${key.trim()}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs), redirect: 'manual', cache: 'no-store',
      });
    } catch { throw new OpenFootError('upstream_unavailable'); }
    if (r.status === 429) {
      const retry = Number(r.headers.get('retry-after'));
      const seconds = Number.isFinite(retry) && retry > 0 ? Math.min(retry, 3600) : 60;
      cooldownUntil = clock() + seconds * 1000;
      await r.body?.cancel();
      throw new OpenFootError('rate_limit', 429, cooldownUntil);
    }
    if (!r.ok) {
      await r.body?.cancel();
      const code = ({ 401: 'invalid_key', 403: 'plan_restricted', 404: 'not_available' })[r.status] || 'upstream_http';
      // Do not persist provider messages: they may contain credentials or account data.
      throw new OpenFootError(code, r.status);
    }
    const payload = await boundedJson(r);
    if (!payload || typeof payload !== 'object' || payload.error || !Object.hasOwn(payload, 'data')) {
      throw new OpenFootError('invalid_envelope');
    }
    return payload;
  }
  async function matchesPage(competition, season, cursor = null) {
    const q = new URLSearchParams({ competition, season, limit: '100' });
    if (cursor !== null) {
      if (typeof cursor !== 'string' || !cursor || cursor.length > 100) throw new OpenFootError('invalid_cursor');
      q.set('cursor', cursor);
    }
    const p = await get(`/v1/matches?${q}`);
    if (!Array.isArray(p.data) || p.meta?.scope?.partial === true || p.meta?.unavailable?.length || p.meta?.preview_limit != null) {
      throw new OpenFootError('incomplete_history');
    }
    const pagination = p.meta?.pagination;
    if (!pagination || !Object.hasOwn(pagination, 'next_cursor') ||
        !(pagination.next_cursor === null || typeof pagination.next_cursor === 'string' && pagination.next_cursor.length > 0 && pagination.next_cursor.length <= 100)) {
      throw new OpenFootError('invalid_pagination');
    }
    if (p.data.some(m => m.competitionId !== competition || m.season !== season)) {
      throw new OpenFootError('competition_or_season_mismatch');
    }
    if (pagination.next_cursor !== null && (pagination.next_cursor === cursor || p.data.length === 0)) {
      throw new OpenFootError('pagination_loop');
    }
    return p;
  }
  async function allMatches(competition, season, maximumPages = 20) {
    const seen = new Set(), ids = new Set(), items = [];
    let cursor = null;
    for (let page = 0; page < maximumPages; page++) {
      const p = await matchesPage(competition, season, cursor);
      for (const match of p.data) {
        if (typeof match.id !== 'string' || ids.has(match.id)) throw new OpenFootError('duplicate_match');
        ids.add(match.id); items.push(match);
      }
      const next = p.meta.pagination.next_cursor;
      if (next === null) {
        if (Number.isInteger(p.meta.total_count) && items.length !== p.meta.total_count) throw new OpenFootError('incomplete_history');
        return items;
      }
      if (seen.has(next)) throw new OpenFootError('pagination_loop');
      seen.add(next); cursor = next;
    }
    throw new OpenFootError('page_budget');
  }
  return { get, matchesPage, allMatches, get requests() { return requests; } };
}
