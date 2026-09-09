/** Executes the actual starter recipes as app_readonly; no production writes. */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { getPool, pinLocalDatabase, end } from "../db/lib/pg";
import { SQL_RECIPES_BY_ID } from "../../src/lib/questions/sql/recipes";
import { renderSqlQuestion } from "../../src/lib/questions/sql/render";
pinLocalDatabase();
const results = [];
for (const recipe of SQL_RECIPES_BY_ID.values()) {
  const client = await getPool().connect();
  const sql = renderSqlQuestion(recipe.id).sql;
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout='8s'");
    await client.query("SET LOCAL ROLE app_readonly");
    const result = await client.query(sql);
    results.push({
      id: recipe.id,
      sqlSha256: createHash("sha256").update(sql).digest("hex"),
      rows: result.rows.length,
      columns: result.fields.map((f) => f.name),
    });
  } catch (error) {
    results.push({ id: recipe.id, error: String(error) });
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}
await end();
writeFileSync(
  "docs/audits/starter-sql-validation-2026-09-10.json",
  JSON.stringify(
    {
      basis:
        "Local app_readonly, 8s timeout, default parameters. Execution checks do not establish every measure or arbitrary input parity.",
      results,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    recipes: results.length,
    errors: results.filter((r) => "error" in r),
  }),
);
if (results.some((r) => "error" in r)) process.exitCode = 1;
