// Build the fit resolver's precompute (schema: 143_funds_fit.sql) — the „финансирано ли е нещо
// като моето" rollup behind the /funds resolver tile and /api/db/funds-fit.
//
// INPUT is already in Postgres; this fetches nothing:
//   fund_projects                    — 82,011 ИСУН contracts, the aggregate's whole basis
//   fund_payloads (kind='procedure') — the procedure NAMES, which ИСУН's export does not carry
//
// The Interreg arm is NOT materialised — `funds_fit_interreg()` reads 1,954 operations and 1,469
// placed Bulgarian partners live, which any index scan answers. See 143's header.
//
// ORDER. Run after `db:load:funds:pg`, which rebuilds both inputs. That is the ONLY staleness
// trigger: the Interreg arm is live, and `funds_fit_basis()` counts both corpora at request time,
// so an Interreg reload needs nothing here. Skipping it after a funds reload is the usual silent
// shape — the resolver keeps answering „340 подобни проекта, медиана €48k" from the previous
// vintage at a 200, and every row count reconciles.
//
// Reload shape: a plain `REFRESH MATERIALIZED VIEW CONCURRENTLY`, which is available because
// `ux_fund_fit_code` is UNIQUE. Concurrently matters — a plain REFRESH takes an
// AccessExclusiveLock for the duration and would 500 the resolver at the pool's lock_timeout,
// which is the `reference_stage_merge_reload` failure class applied to a matview. It falls back
// to a plain refresh on the one case CONCURRENTLY cannot serve: a view that has never been
// populated (`WITH NO DATA`), i.e. the first run on any database.
//
// Run: `npm run db:load:funds-fit:pg` (local) / `:cloud` (Cloud SQL proxy).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, allRows, end } from "./lib/pg";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const SCHEMA = path.join(ROOT, "scripts/db/schema/pg/143_funds_fit.sql");

/** Has the matview ever been populated? CONCURRENTLY refuses an unpopulated one. */
const isPopulated = async (): Promise<boolean> => {
  const rows = await allRows<{ ispopulated: boolean }>(
    `SELECT ispopulated FROM pg_matviews WHERE matviewname = 'fund_fit'`,
  );
  return rows[0]?.ispopulated === true;
};

const main = async (): Promise<void> => {
  // PREFLIGHT. The matview would build happily from an empty `fund_projects` and publish a
  // resolver that answers „нищо подобно не е финансирано" to every question — the exact failure
  // this feature exists to avoid, served at a 200. An empty corpus is a broken load, not a state
  // worth publishing.
  const [pre] = await allRows<{ projects: number; named: number }>(
    `SELECT (SELECT count(*)::int FROM fund_projects) AS projects,
            (SELECT count(*)::int FROM fund_payloads WHERE kind = 'procedure') AS named`,
  );
  if (!pre || pre.projects === 0) {
    throw new Error(
      "fund_projects is empty — run db:load:funds:pg first. Refusing to publish a resolver " +
        "that would answer „nothing like that has been funded" +
        '" to every question.',
    );
  }
  if (pre.named === 0) {
    // Not fatal: 59% of procedures have no name anyway and `sample_title` stands in. But every
    // name missing means the by-procedure shards did not load, and the resolver's result list
    // would be entirely example-titles — worth saying rather than discovering on the page.
    console.warn(
      "funds-fit: fund_payloads(kind='procedure') is empty — every result will fall back to a " +
        "sample project title. Did db:load:funds:pg load the by-procedure shards?",
    );
  }

  console.log(`funds-fit: applying 143 (${pre.projects} projects)`);
  await exec(readFileSync(SCHEMA, "utf8"));

  // 143 is DROP + CREATE … WITH NO DATA, so after an apply the view is always unpopulated and the
  // first refresh is necessarily non-concurrent. The branch is for every SUBSEQUENT run against a
  // database where only this loader ran (`apply_functions.ts` on 143 alone, say).
  const concurrent = await isPopulated();
  console.log(
    `funds-fit: refreshing ${concurrent ? "CONCURRENTLY" : "(first build)"}`,
  );
  await exec(
    `REFRESH MATERIALIZED VIEW ${concurrent ? "CONCURRENTLY " : ""}fund_fit`,
  );

  const [post] = await allRows<{
    rows: number;
    named: number;
    with_median: number;
    with_place: number;
  }>(
    `SELECT count(*)::int AS rows,
            count(*) FILTER (WHERE procedure_name IS NOT NULL)::int AS named,
            count(*) FILTER (WHERE grant_median IS NOT NULL)::int   AS with_median,
            count(*) FILTER (WHERE oblasti <> '{}'::jsonb)::int     AS with_place
       FROM fund_fit`,
  );
  if (!post || post.rows === 0) {
    throw new Error(
      "fund_fit built zero rows from a non-empty fund_projects — the procedure-code derivation " +
        "or the aggregate is broken. Refusing to leave an empty resolver published.",
    );
  }
  console.log(
    `funds-fit: ${post.rows} procedures · ${post.named} named · ` +
      `${post.with_median} with a median grant · ${post.with_place} placed`,
  );

  // The basis, printed — this is what the page declares to a reader, so an operator should see it
  // change. A sudden zero on the Interreg side means 137 was never applied to this database and
  // the resolver is quietly ИСУН-only, which is the bias the two-arm design exists to prevent.
  const [basis] = await allRows<Record<string, number>>(
    `SELECT * FROM funds_fit_basis()`,
  );
  if (basis) {
    console.log(
      `funds-fit: basis — ИСУН ${basis.isun_projects} projects / ${basis.isun_procedures} procedures · ` +
        `Interreg ${basis.interreg_operations} operations / ${basis.interreg_partners} placed partners ` +
        `(${basis.interreg_with_eik} with an EIK)`,
    );
    if (basis.interreg_operations === 0)
      console.warn(
        "funds-fit: the Interreg arm is EMPTY — the resolver will answer border municipalities " +
          "as if nothing near them was ever funded. Run db:load:interreg:pg.",
      );
  }
};

void main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => end());
