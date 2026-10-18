import { normalize } from "./model.js";
export async function saveFixtures(db, items, sourceAt, readBack = false) {
  if (!Number.isFinite(sourceAt) || sourceAt > Date.now())
    throw new Error("invalid_source_timestamp");
  const rows = items.map(normalize).filter(Boolean);
  for (let i = 0; i < rows.length; i += 50)
    await db.batch(
      rows
        .slice(i, i + 50)
        .map((f) =>
          db
            .prepare(
              "INSERT INTO fixtures(id,league,kickoff,finished,data,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET league=excluded.league,kickoff=excluded.kickoff,finished=excluded.finished,data=excluded.data,updated_at=excluded.updated_at WHERE fixtures.updated_at<excluded.updated_at OR (fixtures.updated_at=excluded.updated_at AND fixtures.data<>excluded.data)",
            )
            .bind(
              f.id,
              f.league,
              f.ts,
              f.finished ? 1 : 0,
              JSON.stringify(f),
              sourceAt,
            ),
        ),
    );
  if (!readBack || !rows.length) return rows;
  const current = [];
  for (let i = 0; i < rows.length; i += 50) {
    const ids = rows.slice(i, i + 50).map((r) => r.id);
    const r = await db
      .prepare(
        "SELECT data FROM fixtures WHERE id IN (" +
          ids.map(() => "?").join(",") +
          ")",
      )
      .bind(...ids)
      .all();
    current.push(...r.results.map((r) => JSON.parse(r.data)));
  }
  return current;
}
