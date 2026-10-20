import html from "../index.html";
import { winnerTip, outcome } from "./model.js";
import { fit, predict, VERSION } from "./forecast.js";
import winnerResearch from "./winner-multiscale-research.json";
import { compareForecasts } from "./comparison.js";
import { api, parseOdds, fixtureOdds } from "./provider.js";
import validation from "./validation.json";
import winnerReview from "./winner-review.json";
import luxgValidation from "./luxg-validation.json";
import { forecastWindow, publicGames } from "./window.js";
import { saveFixtures } from "./storage.js";
import {
  readDailyMarkets,
  decorateDailyMarket,
  finalizeDailyMarkets,
} from "./daily-markets.js";
import dailyMarketResearch from "./daily-market-research.json";
import marketExpansionResearch from "./market-expansion-research.json";
import { MIN_ODD, PRICING_VERSION, applyPricing } from "./pricing-policy.js";
import { publishDailyPicks, publishedGames } from "./published-picks.js";
import { runQueuedRefresh } from "./odds-refresh.js";
import {
  COMPETITIONS,
  configuredCompetitions,
  competitionEvidence,
} from "./competitions.js";
import { backfillHistory } from "./history-backfill.js";
const HOUR = 3600000;
const json = (v, status = 200) =>
  Response.json(v, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const meta = async (db, k, v) =>
  db
    .prepare(
      "INSERT INTO meta(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data",
    )
    .bind(k, JSON.stringify(v))
    .run();
async function sync(env, force = false, requestedLeague = null) {
  const now = Date.now(),
    db = env.DB,
    window = forecastWindow(now);
  const lock = await db
    .prepare(
      "INSERT INTO locks(key,until) VALUES('sync',?) ON CONFLICT(key) DO UPDATE SET until=excluded.until WHERE until<? RETURNING key",
    )
    .bind(now + 10 * 60000, now)
    .first();
  if (!lock) return { skipped: true };
  let stale = false,
    processed = 0,
    upstreamDegraded = false,
    failedLeagues = [],
    enrichmentAvailable = true;
  try {
    const dailyPlans = await readDailyMarkets(db, now);
    const historyPlans = [],
      contextTasks = [];
    const configured = configuredCompetitions(env).map((c) => c.id);
    const previous = await db
      .prepare("SELECT data FROM meta WHERE key='sync'")
      .first();
    let pending = [];
    try {
      pending =
        JSON.parse(previous?.data || "{}").failedLeagues?.map(
          (x) => x.league,
        ) || [];
    } catch {}
    // Retry competitions deferred by the provider first, preventing permanent starvation.
    const leagues =
      requestedLeague !== null
        ? configured.filter((id) => id === requestedLeague)
        : [
            ...new Set([
              ...pending.filter((id) => configured.includes(id)),
              ...configured,
            ]),
          ];
    for (const league of leagues) {
      try {
        const coverage = await api(
          env,
          "leagues?id=" +
            league +
            (COMPETITIONS.find((c) => c.id === league)?.validationPending
              ? "&current=true"
              : ""),
          24 * HOUR,
          force,
        );
        let leagueStale = coverage.stale;
        upstreamDegraded ||= !!coverage.refreshFailed;
        const info = coverage.data[0],
          seasons = (info?.seasons || []).filter((s) => s.current);
        if (!seasons.length)
          throw Object.assign(new Error("competition_coverage_unavailable"), {
            code: "competition_coverage_unavailable",
          });
        const season = seasons[0];
        if (info?.league?.id && info.league.id !== league)
          throw new Error("competition_identity_mismatch");
        await meta(db, "coverage:" + league, {
          id: info?.league?.id || league,
          name:
            info?.league?.name ||
            COMPETITIONS.find((c) => c.id === league)?.name,
          checkedAt: Date.now(),
          season: season.year,
          coverage: season.coverage,
        });
        const upcoming = await api(
          env,
          `fixtures?league=${league}&season=${season.year}&from=${new Date(now - 3 * 86400000).toISOString().slice(0, 10)}&to=${new Date(now + 7 * 86400000).toISOString().slice(0, 10)}`,
          30 * 60000,
          force,
        );
        leagueStale ||= upcoming.stale;
        upstreamDegraded ||= !!upcoming.refreshFailed;
        if (upcoming.fromCache === false && !upcoming.stale)
          await meta(db, "last_live_sync", { at: now, league });
        const fixtures = await saveFixtures(
          db,
          upcoming.data,
          upcoming.fetchedAt,
          true,
        );
        const bootstrap = await db
          .prepare("SELECT data FROM meta WHERE key=?")
          .bind("bootstrap:" + league + ":" + season.year)
          .first();
        const historyIncomplete = !bootstrap;
        stale ||= leagueStale || historyIncomplete;
        historyPlans.push({ league, season: season.year });
        const european =
          COMPETITIONS.find((c) => c.id === league)?.kind === "european";
        const historyLeagues = european ? configured : [league];
        const stored = await db
          .prepare(
            "SELECT data FROM fixtures WHERE league IN (" +
              historyLeagues.map(() => "?").join(",") +
              ") AND finished=1 AND kickoff<? AND kickoff>? ORDER BY kickoff",
          )
          .bind(...historyLeagues, now, now - 3 * 365 * 86400000)
          .all();
        const state = fit(
          stored.results.map((r) => JSON.parse(r.data)),
          now,
          validation.opts,
        );
        let enriched = 0;
        const analyzed = fixtures.map((f) => ({
          f,
          p:
            !f.finished && f.ts > now && f.ts < window.end && f.status === "NS"
              ? competitionEvidence(predict(state, f), league)
              : null,
        }));
        // Qualifying price candidates go first, before low-priority enrichment.
        analyzed.sort(
          (a, b) =>
            Number(
              b.p?.sample >= 12 &&
                Math.max(b.p.probabilities.H, b.p.probabilities.A) >= 0.5,
            ) -
              Number(
                a.p?.sample >= 12 &&
                  Math.max(a.p.probabilities.H, a.p.probabilities.A) >= 0.5,
              ) || a.f.ts - b.f.ts,
        );
        for (const { f, p } of analyzed) {
          if (f.finished) {
            await db
              .prepare(
                "INSERT INTO results(fixture_id,hg,ag,settled_at) VALUES(?,?,?,?) ON CONFLICT(fixture_id) DO UPDATE SET hg=excluded.hg,ag=excluded.ag,settled_at=excluded.settled_at",
              )
              .bind(f.id, f.hg, f.ag, now)
              .run();
            continue;
          }
          if (f.ts <= now || f.ts >= window.end || f.status !== "NS") continue;
          let odds = {},
            context = { injuries: null, lineups: null, updatedAt: now };
          let matchStale = leagueStale || historyIncomplete;
          p.historyIncomplete = historyIncomplete;
          if (historyIncomplete)
            p.risks.push(
              "Importação histórica incompleta; cálculo provisório com a amostra disponível, mantendo o mínimo de 12 jogos efetivos por equipa.",
            );
          if (coverage.refreshFailed || upcoming.refreshFailed)
            p.risks.push(
              "Consulta direta falhou; foram utilizados os dados disponíveis em cache.",
            );
          // Prices are independent of injury/lineup failures and cover all three days.
          if (
            season.coverage?.odds &&
            p.sample >= 12 &&
            Math.max(p.probabilities.H, p.probabilities.A) >= 0.5
          ) {
            try {
              odds = (await fixtureOdds(env, f.id, now)).odds;
            } catch {
              p.risks.push("Odds não disponíveis nesta atualização.");
            }
          }
          // Context never changes model probabilities without validation. Reuse
          // its cache here; refresh it only after every competition has prices.
          if (f.ts - now < 24 * HOUR && enriched++ < 8) {
            if (season.coverage?.injuries)
              contextTasks.push({
                path: "injuries?fixture=" + f.id,
                ttl: 6 * HOUR,
              });
            if (f.ts - now < 2 * HOUR && season.coverage?.fixtures?.lineups)
              contextTasks.push({
                path: "fixtures/lineups?fixture=" + f.id,
                ttl: 30 * 60000,
              });
            for (const [field, path] of [
              ["injuries", "injuries?fixture=" + f.id],
              ["lineups", "fixtures/lineups?fixture=" + f.id],
            ]) {
              const saved = await db
                .prepare("SELECT data,expires FROM cache WHERE key=?")
                .bind("api:" + path)
                .first();
              if (saved) {
                try {
                  const payload = JSON.parse(saved.data),
                    items = Array.isArray(payload) ? payload : payload.items;
                  if (Array.isArray(items))
                    context[field] = items.map((x) =>
                      field === "injuries"
                        ? {
                            team: x.team?.name,
                            player: x.player?.name,
                            type: x.player?.type,
                            reason: x.player?.reason,
                          }
                        : {
                            team: x.team?.name,
                            formation: x.formation,
                            players: x.startXI?.map((y) => y.player?.name),
                          },
                    );
                  context[field + "Stale"] = saved.expires <= now;
                } catch {}
              }
            }
          }
          if (season.coverage?.injuries && context.injuries === null)
            p.risks.push("Indisponibilidades não verificadas.");
          if (season.coverage?.fixtures?.lineups && context.lineups === null)
            p.risks.push("Alinhamentos não disponíveis.");
          if (matchStale)
            p.risks.push(
              "Atualização em atraso; seleção de valor suspensa, prognóstico de vencedor apenas provisório.",
            );
          const predictionAt = Date.now();
          if (f.ts <= predictionAt) continue;
          let data = {
            fixture: f,
            prediction: p,
            // The daily overlay preserves the original winner for comparison.
            recommendation: null,
            winnerTip: winnerTip(
              p,
              COMPETITIONS.find((c) => c.id === league)?.validationPending
                ? null
                : winnerResearch.calibration,
              odds,
              {
                now: predictionAt,
                sourceUpdatedAt: upcoming.fetchedAt,
                stale: matchStale,
              },
            ),
            odds,
            context,
            updatedAt: predictionAt,
            sourceUpdatedAt: upcoming.fetchedAt,
            stale: matchStale,
          };
          if (
            data.winnerTip &&
            COMPETITIONS.find((c) => c.id === league)?.validationPending
          ) {
            data.winnerTip.reliability = null;
            data.winnerTip.calibrationStatus =
              "Validação histórica desta competição pendente";
          }
          const phase =
            f.ts - predictionAt <= HOUR && !matchStale
              ? "final"
              : "preliminary";
          const snapshotVersion = VERSION + "@" + f.ts;
          data.phase = phase;
          data = decorateDailyMarket(
            data,
            dailyPlans.find((p) => p.fixture_id === f.id),
            predictionAt,
          );
          // Final predictions stay frozen; preliminary revisions are append-only.
          const final = await db
            .prepare(
              "SELECT data FROM forecasts WHERE fixture_id=? AND version=? AND phase='final' AND kickoff=?",
            )
            .bind(f.id, snapshotVersion, f.ts)
            .first();
          if (!final)
            await db
              .prepare(
                "INSERT OR IGNORE INTO forecasts(fixture_id,version,phase,created_at,kickoff,data) VALUES(?,?,?,?,?,?)",
              )
              .bind(
                f.id,
                snapshotVersion +
                  (phase === "preliminary" ? ":" + predictionAt : ""),
                phase,
                predictionAt,
                f.ts,
                JSON.stringify(data),
              )
              .run();
          await db
            .prepare(
              "INSERT INTO cache(key,data,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,expires=excluded.expires",
            )
            .bind(
              "forecast:" + f.id,
              final
                ? JSON.stringify(
                    decorateDailyMarket(
                      JSON.parse(final.data),
                      dailyPlans.find((p) => p.fixture_id === f.id),
                      now,
                    ),
                  )
                : JSON.stringify(data),
              f.ts + 86400000,
            )
            .run();
          processed++;
        }
      } catch (e) {
        stale = true;
        upstreamDegraded = true;
        failedLeagues.push({ league, code: e.code || "league_sync_failed" });
      }
    }
    // Settle forecasted games from the newest authoritative fixture, including
    // delayed results that no longer occur in the short upcoming window.
    await db
      .prepare(
        `INSERT INTO results(fixture_id,hg,ag,settled_at)
      SELECT f.id,json_extract(f.data,'$.hg'),json_extract(f.data,'$.ag'),?
      FROM fixtures f LEFT JOIN results r ON r.fixture_id=f.id
      WHERE f.finished=1 AND EXISTS(SELECT 1 FROM forecasts p WHERE p.fixture_id=f.id)
      AND (r.fixture_id IS NULL OR r.hg<>json_extract(f.data,'$.hg') OR r.ag<>json_extract(f.data,'$.ag'))
      ON CONFLICT(fixture_id) DO UPDATE SET hg=excluded.hg,ag=excluded.ag,settled_at=excluded.settled_at`,
      )
      .bind(now)
      .run();
    const dailyMarkets = await finalizeDailyMarkets(db);
    const publishRows = await db
      .prepare(
        "SELECT c.data,f.data fixture_data FROM fixtures f JOIN cache c ON c.key='forecast:'||f.id WHERE f.finished=0 AND f.kickoff>? AND f.kickoff<? ORDER BY f.kickoff LIMIT 150",
      )
      .bind(Date.now(), forecastWindow().end)
      .all();
    await publishDailyPicks(db, publicGames(publishRows.results).games);
    const historyBackfill = await backfillHistory(env, historyPlans);
    for (const task of contextTasks.slice(0, 8)) {
      try {
        await api(env, task.path, task.ttl);
      } catch {
        enrichmentAvailable = false;
        break;
      }
    }
    await meta(
      db,
      requestedLeague === null ? "sync" : "sync:competition:" + requestedLeague,
      {
        at: Date.now(),
        ok: true,
        dailyMarkets,
        historyPending: historyBackfill.pending,
        stale,
        processed,
        contextAvailable: enrichmentAvailable,
        failedLeagues,
        upstreamDegraded,
      },
    );
    // Bounded maintenance of obsolete API cache; no forecast history deletion.
    await db
      .prepare("DELETE FROM cache WHERE expires<? AND key LIKE ?")
      .bind(now - 30 * 86400000, "api:%")
      .run();
    return {
      ok: true,
      processed,
      stale,
      failedLeagues,
      historyPending: historyBackfill.pending,
    };
  } catch (e) {
    await meta(
      db,
      requestedLeague === null ? "sync" : "sync:competition:" + requestedLeague,
      {
        at: Date.now(),
        ok: false,
        code: e.code || "sync_failed",
      },
    );
    throw e;
  } finally {
    await db.prepare("DELETE FROM locks WHERE key='sync'").run();
  }
}
async function runRequestedSync(env) {
  const now = Date.now(),
    db = env.DB;
  // api() still blocks all network calls during cooldown, while cached
  // schedules and histories remain usable for calculations.
  const check = await db
    .prepare("SELECT data FROM meta WHERE key='provider:plan-check'")
    .first();
  if (!check || now - JSON.parse(check.data).at > 6 * HOUR) {
    await meta(db, "provider:plan-check", { at: now });
    try {
      const status = await api(env, "status", 6 * HOUR);
      if (status.data[0])
        await meta(db, "provider:plan", { at: now, ...status.data[0] });
    } catch (e) {
      await meta(db, "provider:plan-error", {
        at: now,
        code: e.code || "status_failed",
      });
    }
    return;
  }
  // A terminated foreground invocation must not leave an import stuck forever.
  await db
    .prepare(
      "UPDATE sync_requests SET started_at=NULL,requested_at=? WHERE finished_at IS NULL AND started_at<?",
    )
    .bind(now, now - 10 * 60000)
    .run();
  const job = await db
    .prepare(
      "UPDATE sync_requests SET started_at=?,attempts=attempts+1 WHERE id=(SELECT id FROM sync_requests WHERE finished_at IS NULL AND started_at IS NULL AND requested_at<=? AND attempts<12 ORDER BY requested_at,id LIMIT 1) AND started_at IS NULL RETURNING id,league_id,attempts",
    )
    .bind(now, now)
    .first();
  if (!job) return;
  let result;
  try {
    result = await sync(env, false, job.league_id);
  } catch (e) {
    result = { ok: false, code: e.code || "sync_failed" };
  }
  if (
    result.skipped ||
    !result.ok ||
    result.failedLeagues?.length ||
    result.historyPending?.length
  ) {
    const lock = await db
      .prepare("SELECT until FROM locks WHERE key='api-cooldown'")
      .first();
    await db
      .prepare(
        "UPDATE sync_requests SET started_at=NULL,requested_at=?,result=? WHERE id=?",
      )
      .bind(
        Math.max(Date.now() + 65000, lock?.until || 0),
        JSON.stringify(result),
        job.id,
      )
      .run();
  } else
    await db
      .prepare("UPDATE sync_requests SET finished_at=?,result=? WHERE id=?")
      .bind(Date.now(), JSON.stringify(result), job.id)
      .run();
}
async function authorized(req, secret) {
  if (!secret) return false;
  const token = (req.headers.get("Authorization") || "").replace(
    /^Bearer /,
    "",
  );
  const hash = async (x) =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(x));
  const a = new Uint8Array(await hash(token)),
    b = new Uint8Array(await hash(secret));
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
export default {
  async fetch(req, env, ctx) {
    const u = new URL(req.url);
    try {
      if (req.method === "OPTIONS")
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin":
              "https://90carlosmachado-cpu.github.io",
            "Access-Control-Allow-Methods": "GET",
            "Access-Control-Max-Age": "86400",
          },
        });
      if (u.pathname === "/api/admin/provider") {
        if (!(await authorized(req, env.ADMIN_TOKEN)))
          return json({ error: "Não autorizado" }, 401);
        if (u.searchParams.get("check") === "leagues") {
          try {
            const r = await api(env, "leagues?id=94", 24 * HOUR);
            return json({ ok: true, count: r.data.length, stale: r.stale });
          } catch (e) {
            return json({ code: e.code || "error", reason: e.detail }, 502);
          }
        }
        try {
          const r = await fetch("https://v3.football.api-sports.io/status", {
            headers: {
              "x-apisports-key": env.API_FOOTBALL_KEY,
              "User-Agent": "LuxTips/2.0",
              Accept: "application/json",
            },
            signal: AbortSignal.timeout(20000),
            cache: "no-store",
          });
          const text = await r.text();
          let d;
          try {
            d = JSON.parse(text);
          } catch {}
          return json({
            http: r.status,
            rateLimit: Object.fromEntries(
              [...r.headers].filter(([k]) => k.includes("ratelimit")),
            ),
            type: r.headers.get("content-type"),
            errorCodes: Object.keys(d?.errors || {}),
            subscription: d?.response?.subscription,
            requests: d?.response?.requests,
            parsed: !!d,
          });
        } catch (e) {
          return json(
            {
              kind: e.name,
              reason: String(e.message)
                .replaceAll(env.API_FOOTBALL_KEY, "[redacted]")
                .slice(0, 200),
            },
            502,
          );
        }
      }
      if (u.pathname === "/api/admin/sync") {
        if (req.method !== "POST")
          return json({ error: "Método não permitido" }, 405);
        if (!(await authorized(req, env.ADMIN_TOKEN)))
          return json({ error: "Não autorizado" }, 401);
        return json(await sync(env, u.searchParams.get("force") === "1"));
      }
      if (req.method !== "GET")
        return json({ error: "Método não permitido" }, 405);
      let res;
      if (u.pathname === "/api/health") {
        const s = await env.DB.prepare(
          "SELECT data FROM meta WHERE key='sync'",
        ).first();
        const status = s ? JSON.parse(s.data) : null;
        const live = await env.DB.prepare(
          "SELECT data FROM meta WHERE key='last_live_sync'",
        ).first();
        res = json({
          service: "LuxTips",
          competitions: configuredCompetitions(env),
          version: VERSION,
          sync: status,
          lastLiveRefresh: live ? JSON.parse(live.data) : null,
          ready:
            !!status?.ok &&
            !status?.stale &&
            Number.isFinite(status.at) &&
            status.at <= Date.now() &&
            Date.now() - status.at <= HOUR,
        });
      } else if (u.pathname === "/api/games") {
        const r = await env.DB.prepare(
          "SELECT c.data,f.data fixture_data FROM fixtures f JOIN cache c ON c.key='forecast:'||f.id WHERE f.finished=0 AND f.kickoff>? AND f.kickoff<? ORDER BY f.kickoff LIMIT 150",
        )
          .bind(Date.now(), forecastWindow().end)
          .all();
        const { games: candidates, window } = publicGames(r.results);
        await publishDailyPicks(env.DB, candidates);
        const games = await publishedGames(env.DB);
        const importState = await env.DB.prepare(
          "SELECT COUNT(*) pending FROM sync_requests WHERE finished_at IS NULL",
        ).first();
        ctx.waitUntil(runRequestedSync(env).then(() => runQueuedRefresh(env)));
        res = json({
          games,
          competitions: configuredCompetitions(env),
          imports: { pending: importState?.pending || 0 },
          selectionPolicy: {
            version: PRICING_VERSION,
            minimumOdd: MIN_ODD,
            oddsMaxAgeHours: 6,
            maxAlternativePerDay: 1,
            maxGamesPerDay: 3,
            historicalValidation: "pending-adequate-historical-odds",
          },
          window,
          updatedAt: games.reduce((n, g) => Math.max(n, g.updatedAt), 0),
          validation: {
            holdout: "Avaliação retrospetiva cronológica do modelo de vencedor",
            holdoutMatches: winnerResearch.pooled.candidate.n,
            model: VERSION,
          },
        });
      } else if (u.pathname === "/api/validation") {
        res = json({
          ...validation,
          activeModel: VERSION,
          legacyModel: "luxg-1-opponent-poisson",
          winnerSelection: winnerReview,
          luxg: luxgValidation,
          winnerModel: winnerResearch,
          dailyMarket: dailyMarketResearch,
          marketExpansion: marketExpansionResearch,
          pricePolicy: {
            version: PRICING_VERSION,
            minimumOdd: MIN_ODD,
            historicalValidation: null,
            reason:
              "Os estudos anteriores não aplicam o mínimo de 1,25: faltam odds históricas adequadas.",
          },
        });
      } else if (u.pathname === "/api/history") {
        const r = await env.DB.prepare(
          "SELECT COALESCE((SELECT pp.data FROM published_picks pp WHERE pp.fixture_id=p.fixture_id AND pp.kickoff=p.kickoff ORDER BY pp.published_at LIMIT 1),p.data) data,r.hg,r.ag,r.settled_at FROM forecasts p JOIN results r ON p.fixture_id=r.fixture_id JOIN fixtures f ON f.id=p.fixture_id AND f.kickoff=p.kickoff WHERE f.finished=1 AND p.rowid=(SELECT p2.rowid FROM forecasts p2 WHERE p2.fixture_id=p.fixture_id AND p2.kickoff=p.kickoff ORDER BY p2.created_at DESC,p2.rowid DESC LIMIT 1) ORDER BY p.created_at DESC LIMIT 1000",
        ).all();
        const forecasts = r.results.map((r) => {
          const f = JSON.parse(r.data);
          return {
            ...f,
            result: { home: r.hg, away: r.ag },
            displayHit: f.displayTip
              ? outcome(f.displayTip.market, r.hg, r.ag)
              : null,
            winnerHit: f.winnerTip
              ? outcome(f.winnerTip.market, r.hg, r.ag)
              : null,
            hit: f.recommendation
              ? outcome(f.recommendation.market, r.hg, r.ag)
              : null,
          };
        });
        const publishedRows = await env.DB.prepare(
          `SELECT p.data,r.hg,r.ag FROM (
          SELECT fixture_id,kickoff,published_at,data FROM published_picks
          UNION ALL SELECT fixture_id,kickoff,published_at,data FROM published_alternatives
        ) p JOIN fixtures f ON f.id=p.fixture_id AND f.kickoff=p.kickoff
          JOIN results r ON r.fixture_id=p.fixture_id WHERE f.finished=1 ORDER BY p.published_at DESC LIMIT 1000`,
        ).all();
        const publishedSelections = publishedRows.results.map((row) => {
          const g = JSON.parse(row.data);
          return {
            ...g,
            result: { home: row.hg, away: row.ag },
            winnerHit: g.winnerTip
              ? outcome(g.winnerTip.market, row.hg, row.ag)
              : null,
            displayHit: g.displayTip
              ? outcome(g.displayTip.market, row.hg, row.ag)
              : null,
          };
        });
        const metrics = {};
        for (const f of forecasts) {
          for (const [k, p] of Object.entries(f.prediction.probabilities)) {
            const y = outcome(k, f.result.home, f.result.away);
            metrics[k] ||= {
              n: 0,
              brier: 0,
              logLoss: 0,
              hits: 0,
              bins: Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 })),
            };
            const m = metrics[k];
            m.n++;
            m.brier += (p - y) ** 2;
            m.logLoss -=
              y * Math.log(Math.max(1e-9, p)) +
              (1 - y) * Math.log(Math.max(1e-9, 1 - p));
            m.hits += (p >= 0.5 ? 1 : 0) === y ? 1 : 0;
            const b = m.bins[Math.min(9, Math.floor(p * 10))];
            b.n++;
            b.p += p;
            b.y += y;
          }
        }
        for (const m of Object.values(metrics)) {
          m.brier /= m.n;
          m.logLoss /= m.n;
          m.accuracy = m.hits / m.n;
          m.ece =
            m.bins.reduce((s, b) => s + (b.n ? Math.abs(b.p - b.y) : 0), 0) /
            m.n;
        }
        res = json({
          forecasts,
          publishedSelections,
          modelComparison: compareForecasts(forecasts),
          metrics,
          scope:
            "Seleção publicada quando disponível; nos registos anteriores, último prognóstico pré-jogo. Até 1000 jogos; resultados regulamentares",
        });
      } else if (u.pathname === "/" || u.pathname === "/index.html") {
        return new Response(html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            "Content-Security-Policy":
              "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self' https://luxtips.90carlosmachado.workers.dev; img-src 'self' data:; frame-ancestors 'self' https://web.telegram.org; base-uri 'none'; form-action 'none'",
          },
        });
      } else return json({ error: "Não encontrado" }, 404);
      res.headers.set(
        "Access-Control-Allow-Origin",
        "https://90carlosmachado-cpu.github.io",
      );
      return res;
    } catch {
      console.error(
        JSON.stringify({
          event: "request_failed",
          path: u.pathname.slice(0, 80),
        }),
      );
      return json(
        { error: "Serviço temporariamente indisponível. Tente novamente." },
        503,
      );
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      sync(env)
        .then(() => runRequestedSync(env))
        .catch(() =>
          console.error(JSON.stringify({ event: "scheduled_sync_failed" })),
        ),
    );
  },
};
