import test from "node:test";
import assert from "node:assert/strict";
import { forecastWindow, publicGames } from "../src/window.js";
import { saveFixtures } from "../src/storage.js";
import { database } from "./db.js";
test("three Lisbon calendar days include DST and year boundaries", () => {
  for (const [now, days, end] of [
    [
      "2026-10-18T23:30:00Z",
      ["2026-10-19", "2026-10-20", "2026-10-21"],
      "2026-10-21T23:00:00Z",
    ],
    [
      "2026-10-24T12:00:00Z",
      ["2026-10-24", "2026-10-25", "2026-10-26"],
      "2026-10-27T00:00:00Z",
    ],
    [
      "2026-03-28T12:00:00Z",
      ["2026-03-28", "2026-03-29", "2026-03-30"],
      "2026-03-30T23:00:00Z",
    ],
    [
      "2026-12-31T12:00:00Z",
      ["2026-12-31", "2027-01-01", "2027-01-02"],
      "2027-01-03T00:00:00Z",
    ],
  ]) {
    const w = forecastWindow(Date.parse(now));
    assert.deepEqual(w.days, days);
    assert.equal(w.end, Date.parse(end));
  }
});
test("public forecasts exclude day +3, postponements and outdated kickoff/team identities", () => {
  const now = Date.parse("2026-10-18T22:55:00Z"),
    end = forecastWindow(now).end;
  const f = {
    id: 1,
    ts: now + 60000,
    home: 11,
    away: 12,
    status: "NS",
    finished: false,
  };
  const row = (current = f, published = f) => ({
    fixture_data: JSON.stringify(current),
    data: JSON.stringify({ fixture: published }),
  });
  const rs = [
    row(),
    row({ ...f, id: 2, ts: end - 1 }, { ...f, id: 2, ts: end - 1 }),
    row({ ...f, ts: end }, { ...f, ts: end }),
    row({ ...f, status: "PST" }),
    row({ ...f, ts: f.ts + 60000 }),
    row({ ...f, home: 99 }),
    row({ ...f, finished: true }),
    { data: "bad", fixture_data: "{}" },
  ];
  const r = publicGames(rs, now);
  assert.equal(r.games.length, 2);
  assert.ok(r.games.every((g) => g.fixture.ts < end));
});
test("older cached seasons cannot reverse newer results; unchanged fresh data advances source time", async () => {
  const db = database(),
    base = Date.now() - 3600000;
  const raw = {
    fixture: {
      id: 10,
      date: new Date(base).toISOString(),
      status: { short: "NS" },
    },
    league: { id: 94, season: 2026 },
    teams: { home: { id: 11, name: "A" }, away: { id: 12, name: "B" } },
    score: { fulltime: { home: null, away: null } },
  };
  const done = structuredClone(raw);
  done.fixture.status.short = "FT";
  done.score.fulltime = { home: 2, away: 1 };
  await saveFixtures(db, [done], base + 100);
  const authoritative = await saveFixtures(db, [raw], base, true);
  assert.equal(authoritative[0].finished, true);
  assert.equal(authoritative[0].hg, 2);
  await saveFixtures(db, [done], base + 300);
  await saveFixtures(db, [raw], base + 200);
  const stored = await db
    .prepare("SELECT data,updated_at FROM fixtures WHERE id=10")
    .first();
  assert.equal(JSON.parse(stored.data).finished, true);
  assert.equal(stored.updated_at, base + 300);
});
