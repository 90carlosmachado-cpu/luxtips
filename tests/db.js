import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
export function database() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(fs.readFileSync("migrations/0001.sql", "utf8"));
  const wrap = (text, params = []) => ({
    bind(...p) {
      return wrap(text, p);
    },
    async first() {
      return sql.prepare(text).get(...params) || null;
    },
    async all() {
      return { results: sql.prepare(text).all(...params) };
    },
    async run() {
      const r = sql.prepare(text).run(...params);
      return { meta: { changes: Number(r.changes) } };
    },
  });
  return {
    prepare: wrap,
    async batch(stmts) {
      sql.exec("BEGIN");
      try {
        const r = await Promise.all(stmts.map((s) => s.run()));
        sql.exec("COMMIT");
        return r;
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    },
    sql,
  };
}
