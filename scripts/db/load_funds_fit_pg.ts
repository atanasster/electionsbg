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
// 144 IS APPLIED HERE TOO, and it needs an applier or nothing ever runs it. `funds_news` reads
// `fund_fit` — 144's whole third card comes out of this matview — so this loader is the natural
// home, and without it `db:refresh` fails at its final `test:data` step on any machine that has
// not applied 144 by hand. It also carries `idx_ifs_source_seen`, without which the wire is a
// 30,105-buffer scan on every /funds view.
const SCHEMA_WIRE = path.join(ROOT, "scripts/db/schema/pg/144_funds_wire.sql");
// 145 IS APPLIED HERE, AND THIS IS THE ONLY PLACE IT CAN BE. It is the /funds hub's one stat
// call, and its primary input is the funds corpus — so `load_funds_pg.ts` looks like its home
// and is not: `CREATE MATERIALIZED VIEW` resolves its query at creation, 145 needs
// `canon_oblast`, and 143 (which defines it) is applied by THIS loader, one `db:refresh` step
// later. Applied from there it failed with `function canon_oblast(text) does not exist` and
// rolled back a 57-step chain at step 10.
const SCHEMA_HUB = path.join(
  ROOT,
  "scripts/db/schema/pg/145_funds_hub_stats.sql",
);

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

  // 144 AFTER the refresh: `funds_news` reads `fund_fit`, and on a first build the matview does
  // not exist until the statement above has run. The index it creates is ~122 MB on a full
  // `ingest_first_seen` and cannot be CONCURRENT here (apply_functions runs the file as one
  // transaction), so it holds a write lock on that table for the duration — seconds locally,
  // longer on Cloud SQL. That is why it lives at the END of this loader rather than at the start
  // of the chain: nothing else is waiting on it.
  console.log(
    "funds-fit: applying 144 (wire + news rail, + idx_ifs_source_seen)",
  );
  await exec(readFileSync(SCHEMA_WIRE, "utf8"));
  const [wire] = await allRows<{ checked_on: string | null }>(
    `SELECT checked_on FROM funds_wire(30)`,
  );
  console.log(
    `funds-fit: wire reports last ingest ${wire?.checked_on ?? "(never)"}`,
  );

  // ── 145, the /funds hub's stat cache ─────────────────────────────────────────────────────
  //
  // GUARDED ON THE INTERREG TABLES, because 145 reads them and they land 41 steps later
  // (`db:load:interreg:pg`). That is a real cycle — 145's primary input is the funds corpus
  // here at step 11, its Interreg arm is at step 52 — so it is refreshed from BOTH ends and
  // `db:load:interreg:pg` refreshes it again. On a FIRST-EVER run this branch skips and step 52
  // populates it; on later runs this refreshes with the previous Interreg vintage and step 52
  // corrects it. Stated in 145's header too, because a reader of either file needs it.
  // `dual_corpus_company_count()` belongs to migration 077 and is applied by the CONTRACTS
  // loader, not by anything in the funds chain — so on a database without contracts it is
  // absent, and `CREATE MATERIALIZED VIEW` resolving 145's query would raise 42883 and kill
  // `db:refresh` at step 11. That is precisely the abort this whole branch exists to prevent,
  // reintroduced by a later edit to 145; the probe has to list every object 145 reads.
  //
  // It probes the FUNCTION, not `dual_corpus_rankings_cache`, and the two are not
  // interchangeable. 145 reads that matview through a plpgsql wrapper precisely so no pg_depend
  // edge is recorded — 077 no longer DROPs it, but it did until 2026-08-10, and the direct read
  // aborted every `db:load:pg` with 2BP01 (see 077's header, which also documents the one-time
  // manual DROP the wrapper keeps safe). The wrapper is therefore what 145's query actually
  // resolves against, and the wrapper itself tolerates an absent or unpopulated cache. Probing
  // the matview here would be probing the wrong object in both directions: it can be present
  // while the function is missing (a database predating this migration's current text), and
  // absent-but-recoverable while the function is there.
  const [deps] = await allRows<{
    ops: string | null;
    parts: string | null;
    dual: string | null;
  }>(
    `SELECT to_regclass('public.interreg_operations')::text             AS ops,
            to_regclass('public.interreg_partners')::text               AS parts,
            to_regprocedure('public.dual_corpus_company_count()')::text AS dual`,
  );
  if (!deps?.ops || !deps?.parts || !deps?.dual) {
    console.warn(
      "funds-fit: skipping 145 (hub stats) — one of interreg_operations / interreg_partners / " +
        "dual_corpus_company_count() is absent. db:load:pg (contracts) and db:load:interreg:pg " +
        "create them; the /funds hub renders without figures until then.",
    );
  } else {
    console.log("funds-fit: applying 145 (hub stats) + refreshing");
    await exec(readFileSync(SCHEMA_HUB, "utf8"));
    // 145 creates WITH NO DATA, so the first refresh cannot be CONCURRENT. Probed rather than
    // caught: an error catch here is how the previous draft hid a PERMANENT CONCURRENTLY
    // failure (its unique index was on an expression, which does not qualify) behind what
    // looked like a first-run fallback.
    const [mv] = await allRows<{ ispopulated: boolean }>(
      `SELECT ispopulated FROM pg_matviews WHERE matviewname = 'funds_hub_stats_cache'`,
    );
    await exec(
      mv?.ispopulated
        ? "REFRESH MATERIALIZED VIEW CONCURRENTLY funds_hub_stats_cache"
        : "REFRESH MATERIALIZED VIEW funds_hub_stats_cache",
    );
  }

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
