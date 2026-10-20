import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPETITIONS,
  configuredCompetitions,
  competitionEvidence,
  historyPath,
} from "../src/competitions.js";
import worker from "../dist/worker.js";
import { database } from "./db.js";
import { api } from "../src/provider.js";
test("all ten requested competitions survive configuration, without accepting arbitrary ids", () => {
  assert.equal(COMPETITIONS.length, 10);
  assert.deepEqual(
    configuredCompetitions({
      LEAGUES: "94,39,140,78,135,61,88,2,3,848,999999,2",
    }).map((c) => c.id),
    [94, 39, 140, 78, 135, 61, 88, 2, 3, 848],
  );
  const original = {
    risks: [
      "Original",
      "Combinação validada retrospetivamente; melhoria futura ainda por confirmar.",
    ],
  };
  assert.equal(competitionEvidence(original, 94), original);
  for (const id of [88, 2, 3, 848]) {
    const p = competitionEvidence(original, id);
    assert.equal(p.modelEvidence, "competition-validation-pending");
    assert.ok(!p.risks.some((x) => x.includes("Combinação validada")));
  }
  assert.equal(original.risks.length, 2);
  assert.equal(
    historyPath(2, 2026, Date.parse("2026-10-20T07:00:00Z")),
    "fixtures?league=2&season=2026&from=2026-01-01&to=2026-10-20",
  );
  assert.equal(
    historyPath(3, 2023, Date.parse("2026-10-20T07:00:00Z")),
    "fixtures?league=3&season=2023&from=2023-01-01&to=2024-12-31",
  );
  assert.equal(historyPath(94, 2026), "fixtures?league=94&season=2026");
});
test("private requests load all four additions, calculate pre-match forecasts and keep imported calibration pending", async () => {
  const DB = database(),
    old = globalThis.fetch,
    now = Date.now();
  const ids = [2, 3, 848, 88];
  const env = {
    DB,
    API_FOOTBALL_KEY: "test",
    ADMIN_TOKEN: "private",
    LEAGUES: ids.join(","),
    DAILY_BUDGET: "600",
  };
  function item(id, league, ts, finished = false) {
    return {
      fixture: {
        id,
        date: new Date(ts).toISOString(),
        status: { short: finished ? "FT" : "NS" },
      },
      league: {
        id: league,
        name: COMPETITIONS.find((c) => c.id === league).name,
        season: 2026,
      },
      teams: {
        home: { id: league * 100 + 1, name: "Home" },
        away: { id: league * 100 + 2, name: "Away" },
      },
      score: {
        fulltime: { home: finished ? 3 : null, away: finished ? 0 : null },
      },
    };
  }
  globalThis.fetch = async (url) => {
    const u = new URL(url),
      league = Number(u.searchParams.get("league") || u.searchParams.get("id"));
    let response = [];
    if (u.pathname === "/leagues")
      response = [
        {
          league: {
            id: league,
            name: COMPETITIONS.find((c) => c.id === league).name,
          },
          seasons: [{ year: 2026, current: true, coverage: { odds: true } }],
        },
      ];
    else if (
      u.pathname === "/fixtures" &&
      u.searchParams.has("from") &&
      u.searchParams.get("from") !== u.searchParams.get("season") + "-01-01"
    )
      response = [item(70000000 + league, league, now + 3600000)];
    else if (u.pathname === "/fixtures")
      response = Array.from({ length: 100 }, (_, i) =>
        item(
          league * 1000000 + Number(u.searchParams.get("season")) * 100 + i,
          league,
          now - (i + 1) * 3 * 86400000,
          true,
        ),
      );
    else if (u.pathname === "/odds")
      response = [
        {
          fixture: { id: Number(u.searchParams.get("fixture")) },
          update: new Date(now - 1000).toISOString(),
          bookmakers: [
            {
              name: "Test Book",
              bets: [
                {
                  name: "Match Winner",
                  values: [
                    { value: "Home", odd: "1.5" },
                    { value: "Draw", odd: "4" },
                    { value: "Away", odd: "6" },
                  ],
                },
              ],
            },
          ],
        },
      ];
    return Response.json({
      response,
      errors: [],
      paging: { current: 1, total: 1 },
    });
  };
  try {
    await DB.prepare(
      "INSERT INTO meta(key,data) VALUES('provider:plan-check',?)",
    )
      .bind(JSON.stringify({ at: now }))
      .run();
    for (const id of ids) {
      await DB.prepare(
        "INSERT INTO sync_requests(id,league_id,requested_at) VALUES(?,?,?)",
      )
        .bind("job-" + id, id, now - 1000)
        .run();
      if (id === 2)
        await DB.prepare("UPDATE sync_requests SET started_at=? WHERE id=?")
          .bind(now - 11 * 60000, "job-" + id)
          .run();
      let job;
      for (let pass = 0; pass < 5; pass++) {
        await DB.prepare("UPDATE sync_requests SET requested_at=0 WHERE id=?")
          .bind("job-" + id)
          .run();
        const tasks = [];
        const response = await worker.fetch(
          new Request("https://test/api/games"),
          env,
          {
            waitUntil(p) {
              tasks.push(p);
            },
          },
        );
        assert.equal(response.status, 200);
        await Promise.all(tasks);
        job = await DB.prepare("SELECT * FROM sync_requests WHERE id=?")
          .bind("job-" + id)
          .first();
        if (job.finished_at) break;
      }
      assert.ok(job.finished_at, job.result);
      const cached = await DB.prepare("SELECT data FROM cache WHERE key=?")
        .bind("forecast:" + (70000000 + id))
        .first();
      assert.ok(cached, "forecast for " + id);
      const game = JSON.parse(cached.data);
      assert.equal(
        game.prediction.modelEvidence,
        "competition-validation-pending",
      );
      assert.equal(game.winnerTip.reliability, null);
      assert.match(game.winnerTip.calibrationStatus, /pendente/);
      assert.ok(game.updatedAt < game.fixture.ts);
      const saved = await DB.prepare("SELECT data FROM meta WHERE key=?")
        .bind("coverage:" + id)
        .first();
      assert.equal(JSON.parse(saved.data).id, id);
    }
    const r = await worker.fetch(new Request("https://test/api/games"), env, {
      waitUntil() {},
    });
    const d = await r.json();
    assert.deepEqual(
      d.competitions.map((c) => c.id),
      [88, 2, 3, 848],
    );
    assert.equal(
      (
        await DB.prepare(
          "SELECT COUNT(DISTINCT league) n FROM fixtures",
        ).first()
      ).n,
      4,
    );
  } finally {
    globalThis.fetch = old;
  }
});

test("subscription checks cache quota fields without account identity", async () => {
  const DB = database(),
    old = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      errors: [],
      response: {
        account: { email: "private@example.invalid" },
        subscription: { plan: "Pro", active: true },
        requests: { current: 24, limit_day: 7500 },
      },
    });
  try {
    const r = await api(
      { DB, API_FOOTBALL_KEY: "test", DAILY_BUDGET: 600 },
      "status",
      3600000,
    );
    assert.equal(r.data[0].subscription.plan, "Pro");
    const row = await DB.prepare(
      "SELECT data FROM cache WHERE key='api:status'",
    ).first();
    assert.ok(!row.data.includes("private@example.invalid"));
    assert.ok(!row.data.includes("account"));
  } finally {
    globalThis.fetch = old;
  }
});
