// Load the Commerce-Registry (TR) companies + officers into Postgres for name
// search. Reads raw_data/tr/state.sqlite (the existing TR store), folds names via
// translit_bg_latin (a generated column), and builds GIN trigram indexes after
// the bulk load. Officers are deduped to one row per (uic, name).
//
//   npm run db:load:tr:pg        (needs `npm run db:pg:up` first)
//
// See docs/plans/postgres-migration-v1.md (Feature 1).

import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { getPool, exec, withClient, end } from "./lib/pg";

const TR_DB = fileURLToPath(
  new URL("../../raw_data/tr/state.sqlite", import.meta.url),
);
const FN_SQL = fileURLToPath(
  new URL("./schema/pg/000_search_fns.sql", import.meta.url),
);
const TR_SQL = fileURLToPath(
  new URL("./schema/pg/003_tr_search.sql", import.meta.url),
);
const API_SQL = fileURLToPath(
  new URL("./schema/pg/004_search_api.sql", import.meta.url),
);

const gitSha = (): string => {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
};

const waitForPg = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) {
    try {
      await getPool().query("SELECT 1");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error("Postgres not reachable — run `npm run db:pg:up`.");
};

// Batched multi-row INSERT — cap each statement well under PG's 65535 params.
const bulkInsert = async (
  table: string,
  cols: string[],
  rows: unknown[][],
): Promise<void> => {
  const n = cols.length;
  const batch = Math.floor(60000 / n);
  await withClient(async (c) => {
    await c.query("BEGIN");
    for (let i = 0; i < rows.length; i += batch) {
      const slice = rows.slice(i, i + batch);
      const values = slice
        .map(
          (_, r) =>
            `(${cols.map((_, col) => `$${r * n + col + 1}`).join(",")})`,
        )
        .join(",");
      await c.query(
        `INSERT INTO ${table} (${cols.join(",")}) VALUES ${values}`,
        slice.flat(),
      );
    }
    await c.query("COMMIT");
  });
};

export const loadTrPg = async (): Promise<{
  companies: number;
  officers: number;
}> => {
  await waitForPg();
  await exec(readFileSync(FN_SQL, "utf8"));
  await exec(readFileSync(TR_SQL, "utf8"));

  const tr = new DatabaseSync(TR_DB, { readOnly: true });

  const companies = tr
    .prepare(
      "SELECT uic, name, legal_form, seat, status FROM companies WHERE name IS NOT NULL AND name <> ''",
    )
    .all() as Array<Record<string, string | null>>;
  await bulkInsert(
    "tr_companies",
    ["uic", "name", "legal_form", "seat", "status"],
    companies.map((r) => [r.uic, r.name, r.legal_form, r.seat, r.status]),
  );

  const officers = tr
    .prepare(
      `SELECT uic, name,
              group_concat(DISTINCT role) AS roles,
              MAX(CASE WHEN erased_at IS NULL THEN 1 ELSE 0 END) AS active
       FROM company_persons
       WHERE name IS NOT NULL AND name <> ''
       GROUP BY uic, name`,
    )
    .all() as Array<Record<string, string | number | null>>;
  await bulkInsert(
    "tr_officers",
    ["uic", "name", "roles", "active"],
    officers.map((r) => [r.uic, r.name, r.roles, r.active]),
  );
  tr.close();

  // One-shot index build (cheaper than incremental during load).
  await exec(
    "CREATE INDEX idx_tr_companies_fold ON tr_companies USING gin (name_fold gin_trgm_ops)",
  );
  await exec(
    "CREATE INDEX idx_tr_officers_fold ON tr_officers USING gin (name_fold gin_trgm_ops)",
  );
  await exec("CREATE INDEX idx_tr_officers_uic ON tr_officers (uic)");
  await exec("ANALYZE tr_companies");
  await exec("ANALYZE tr_officers");

  // Search API functions (idempotent; depend on the tables + contracts).
  await exec(readFileSync(API_SQL, "utf8"));

  await exec(
    "CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text)",
  );
  await withClient(async (c) => {
    for (const [k, v] of [
      ["tr_schema_version", "pg/003_tr_search.sql"],
      ["tr_generated_at", new Date().toISOString()],
      ["tr_code_git_sha", gitSha()],
      ["tr_companies", String(companies.length)],
      ["tr_officers", String(officers.length)],
    ])
      await c.query(
        "INSERT INTO meta (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        [k, v],
      );
  });

  return { companies: companies.length, officers: officers.length };
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (!existsSync(TR_DB)) {
    console.error(`No TR store at ${TR_DB} — run the TR ingest first.`);
    process.exit(1);
  }
  const t0 = Date.now();
  loadTrPg()
    .then(async ({ companies, officers }) => {
      console.log(
        `loaded ${companies} companies + ${officers} officers → Postgres in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
      );
      await end();
    })
    .catch(async (e) => {
      console.error(e);
      await end();
      process.exit(1);
    });
}
