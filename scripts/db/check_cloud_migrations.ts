// Is Cloud SQL running the SAME schema objects as local — the check nothing did?
//
// WHY THIS EXISTS. This repo has a whole documented class of change it calls
// "applied, never loaded": a serving FUNCTION, VIEW or INDEX carries no data, so
// no `db:load:*` ships it, and `npm run deploy:db` ships function CODE in
// `functions/` — a different thing from a Postgres function. CLAUDE.md names the
// hazard in prose and gives the `apply_functions.ts` hatch. Nothing checked.
//
// And the orchestrator structurally cannot. `process-watch-report` step 9 keys
// its `:cloud` publish table on WHICH SKILL RAN, i.e. on a watcher flip in an
// upstream SOURCE. A migration edited by a code commit flips no watcher, so no
// row of that table fires — while the function it changed keeps serving the old
// body on prod indefinitely, with every row count reconciling.
//
// Measured 2026-08-27, on a database everything else said was healthy:
//
//   · budget_hub_stats()          old body, 6,477 B vs 13,548 B — EIGHT fields
//     + budget_hub_stats_cache    missing, all eight read by budgetHubFigures.ts
//   · budget_admin_list()         missing the node_id tiebreak that 156's evidence
//                                 aside must rank identically to, or the /budget
//                                 head and /budget/ministries disagree on who is 5th
//   · council_councillor_by_slug() ABSENT — degrades to null, so the councillor
//                                 voting record simply never appears on /person
//   · person_by_slug()            missing `linkBasis` on the NGO arm, so 5,670 of
//                                 5,727 board seats rendered with no basis mark
//   · mp_tr_roles()               pre-correlation body: 7,745 buffers vs 867
//
// Every one of those is silent from the reader's side — a hidden block, a weaker
// claim, a slower query. None is a 500.
//
// WHAT IT COMPARES. Definitions, not data: `pg_get_functiondef` for every public
// function, `pg_get_viewdef` for every view and matview, and bare presence for
// every relation. Data divergence between the two databases is EXPECTED and is
// deliberately not checked here — local and cloud legitimately hold different
// person-layer vintages (CLAUDE.md's slug-lock section), and a checker that
// flagged it would cry wolf on every run.
//
// LOCAL-ONLY OBJECTS ARE NOT AUTOMATICALLY A DEFECT, and telling the two apart is
// the whole trick. A local database accumulates scratch from ad-hoc measurement
// (`_pid_before`, `_pp_bak`, `_shard_keys`, `_old_search` were all present when
// this was written). So an object missing on cloud is reported as a GAP only when
// some `schema/pg/*.sql` file still creates it — the same discriminator
// `collateral_drop.ts` uses, and one that needs no allowlist to keep in step.
//
//   npm run db:check-cloud
//   npm run db:check-cloud -- --quiet    # only the verdict
//
// Read-only. It never applies anything: it prints the `apply_functions.ts` line
// and exits 1, because this repo's standing rule is that a checker emits the
// production command rather than running it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { LOCAL_DATABASE_URL } from "./lib/pg";

const SCHEMA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "schema/pg",
);

const CLOUD_DATABASE_URL =
  process.env.CLOUD_DATABASE_URL ??
  "postgres://postgres@127.0.0.1:5434/electionsbg";

interface Obj {
  name: string;
  kind: "function" | "view" | "matview" | "table" | "index";
  def: string;
}

const OBJECTS_SQL = `
  SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS name,
         'function'::text AS kind,
         md5(pg_get_functiondef(p.oid)) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
  UNION ALL
  SELECT c.relname,
         CASE c.relkind WHEN 'm' THEN 'matview' WHEN 'v' THEN 'view' ELSE 'table' END,
         -- A table has no definition to compare; presence is the whole check for it.
         -- Column-level drift is a real class (a missing column raises 42703, which
         -- db_routes.js does NOT degrade on anywhere it has not been taught to) but it
         -- needs a different comparison, and claiming to cover it here would be worse
         -- than not covering it.
         CASE WHEN c.relkind IN ('v', 'm') THEN md5(pg_get_viewdef(c.oid)) ELSE '' END
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
  UNION ALL
  -- Indexes are in the SAME "applied, never loaded" class as functions — CLAUDE.md names
  -- 081's alongside 007's query builders — and they are the half this check missed on its
  -- first cut. A missing index does not change an answer, so nothing about the payload,
  -- the row counts or the function bodies can reveal it; it surfaces only as a query that
  -- got slower, which on a pooled route under a 10 s statement_timeout is a 500 nobody can
  -- attribute. idx_person_role_ref is the worked example: without it an anti-join scanned
  -- the whole index per probe, 23,916 probes x 3.1 ms = 74 s.
  --
  -- The DEFINITION is compared, not just the name: a same-named index rebuilt over
  -- different columns, or without its partial WHERE, is the silent half of this.
  SELECT i.indexname, 'index'::text, md5(i.indexdef)
    FROM pg_indexes i
   WHERE i.schemaname = 'public'
`;

const read = async (url: string, label: string): Promise<Map<string, Obj>> => {
  const pool = new Pool({ connectionString: url, max: 2 });
  pool.on("error", () => {});
  try {
    const { rows } = await pool.query<Obj>(OBJECTS_SQL);
    return new Map(rows.map((r) => [`${r.kind}:${r.name}`, r]));
  } catch (e) {
    throw new Error(
      `could not read ${label} (${url.replace(/:[^:@/]+@/, ":***@")}): ${(e as Error).message}` +
        (label === "cloud"
          ? "\n  The Cloud SQL proxy is a real failure mode. Check `nc -z 127.0.0.1 5434`; restart with `npm run db:proxy:cloud`."
          : ""),
    );
  } finally {
    await pool.end();
  }
};

/** The bare object name, without a function's argument list. */
const bareName = (key: string): string =>
  key.slice(key.indexOf(":") + 1).replace(/\(.*$/, "");

/** Which schema file still CREATEs this object. An object no file creates was retired on
 *  purpose, or is local scratch — either way its absence on cloud is not a gap. */
const creatorFile = (key: string): string | undefined => {
  const name = bareName(key);
  // Anchored on the name so a substring match cannot claim the wrong file, and
  // covering every CREATE spelling these migrations actually use.
  const re = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:UNIQUE\\s+)?(?:UNLOGGED\\s+)?` +
      `(?:MATERIALIZED\\s+VIEW|VIEW|TABLE|FUNCTION|INDEX)\\s+` +
      `(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:public\\.)?${name}\\b`,
    "i",
  );
  return fs
    .readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .find((f) => re.test(fs.readFileSync(path.join(SCHEMA_DIR, f), "utf8")));
};

const main = async (): Promise<number> => {
  const quiet = process.argv.includes("--quiet");
  const [local, cloud] = await Promise.all([
    read(LOCAL_DATABASE_URL, "local"),
    read(CLOUD_DATABASE_URL, "cloud"),
  ]);

  const missing: { key: string; file: string }[] = [];
  const scratch: string[] = [];
  const differs: { key: string; file: string | undefined }[] = [];

  for (const [key] of local) {
    if (cloud.has(key)) continue;
    const file = creatorFile(key);
    if (file) missing.push({ key, file });
    else scratch.push(key);
  }
  for (const [key, l] of local) {
    const c = cloud.get(key);
    if (c && l.def !== c.def) differs.push({ key, file: creatorFile(key) });
  }
  // An object on cloud that local does not have. Not the same defect and not
  // necessarily one at all (a retirement applied on one side only), but it means
  // the two schemas disagree, so it is reported rather than swallowed.
  const orphans = [...cloud.keys()].filter((k) => !local.has(k));

  if (!quiet) {
    console.log(
      `local ${local.size} objects · cloud ${cloud.size} objects` +
        ` (${CLOUD_DATABASE_URL.replace(/:[^:@/]+@/, ":***@")})`,
    );
    for (const { key, file } of missing)
      console.log(`✗ MISSING ON CLOUD  ${key}   (created by ${file})`);
    for (const { key, file } of differs)
      console.log(
        `✗ BODY DIFFERS      ${key}   (${file ?? "no schema file creates this"})`,
      );
    for (const key of orphans) console.log(`? CLOUD-ONLY        ${key}`);
    for (const key of scratch)
      console.log(`· local-only, no schema file creates it — scratch: ${key}`);
  }

  if (!missing.length && !differs.length && !orphans.length) {
    console.log(
      `\nCloud SQL matches local on all ${local.size - scratch.length} schema-owned objects.`,
    );
    return 0;
  }

  // Index-only drift is deliberately EXCLUDED from this command: as the note below
  // explains, applying the file cannot repair a same-named index, so emitting a
  // production command that provably no-ops is worse than emitting none.
  const files = [
    ...new Set(
      [
        ...missing.map((m) => m.file),
        ...differs
          .filter((d) => !d.key.startsWith("index:"))
          .map((d) => d.file),
      ].filter((f): f is string => Boolean(f)),
    ),
  ].sort();
  console.log(
    `\n${missing.length} missing, ${differs.length} out of date, ${orphans.length} cloud-only.`,
  );
  // ⚠️ A DIFFERING INDEX IS THE ONE CASE WHERE "apply it to cloud" CAN BE THE WRONG
  // ADVICE, so it gets its own note rather than being folded into the command below.
  // Every index in these migrations is `CREATE INDEX IF NOT EXISTS`, which does not
  // compare definitions — it sees the NAME, finds it, and no-ops. So a same-named index
  // built over different columns is immovable by re-applying the file, on EITHER side,
  // and this check cannot tell you which side is right: it compares the two databases,
  // not either one against the migration. Read the file and decide.
  //
  // Live example, measured 2026-08-27: idx_person_role_place was
  // (place_kind, place_code) on local and (place_code, source) on cloud. 115 declares the
  // SECOND, so cloud was correct and local had silently kept an older definition through
  // every resolve since.
  const idxDiffers = differs.filter((d) => d.key.startsWith("index:"));
  if (idxDiffers.length)
    console.log(
      `\n⚠️ ${idxDiffers.length} index definition(s) differ. CREATE INDEX IF NOT EXISTS matches on NAME\n` +
        `   only, so re-applying the file repairs neither side — and this check does not know which\n` +
        `   side matches the migration. Read the file, then DROP and recreate on whichever is wrong:\n` +
        idxDiffers
          .map((d) => `     ${d.key.slice(6)}  (${d.file ?? "no schema file"})`)
          .join("\n") +
        "\n",
    );

  if (files.length) {
    console.log(`\nApply to Cloud SQL — ⚠️ READ EACH FILE'S HEADER FIRST:\n`);
    console.log(
      `  DATABASE_URL=${CLOUD_DATABASE_URL} npx tsx scripts/db/apply_functions.ts \\\n    ${files.join(" \\\n    ")}\n`,
    );
    // NOT a blind command. Several of these files open with DROP MATERIALIZED
    // VIEW and rebuild WITH DATA inside one transaction, so applying them blocks
    // that matview's readers for the rebuild — and a few have a LOADER that is
    // the documented path precisely because it also refreshes (156 →
    // db:load:budget-hub:pg:cloud). Ordering matters too: a LANGUAGE sql body is
    // validated at CREATE, so a file reading another file's object must follow it.
    console.log(
      `  Order matters (a LANGUAGE sql body is validated at CREATE), and a file with a\n` +
        `  loader that also REFRESHes should go through that loader instead. Off-peak for\n` +
        `  anything that DROPs a matview.\n`,
    );
  }
  return 1;
};

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(1);
  },
);
