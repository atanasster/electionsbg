// Copy the open-calls ENRICHMENT OVERLAY from one database to another.
//
//   npm run opencalls:sync-enrichment -- --to <url>          dry run
//   npm run opencalls:sync-enrichment:cloud                  dry run, local → Cloud SQL
//   npm run opencalls:sync-enrichment:cloud -- --apply       … and write
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// WHY THIS EXISTS. Everything else about `open_calls` travels: `db:load:open-calls:pg:cloud`
// re-reads the committed `data/opencalls/*.json` snapshots against Cloud SQL and the corpus
// lands. The ENRICHMENT does not, and that is deliberate — `enrichment`, `enrichment_meta`,
// `beneficiaries_raw` and the four money columns are written by Stage 7
// (`scripts/opencalls/enrich_apply.ts`) straight into Postgres and are in no committed file.
// CLAUDE.md's instruction — „enrich against the database you intend to serve" — is the correct
// rule and it is also the one that gets forgotten, because enriching is a slow human pass and
// the obvious place to do it is the database that is already loaded, i.e. local.
//
// Measured 2026-08-09: one `auto` row (isun/005e2518-…) had to be moved local → Cloud SQL by
// hand. The 16 other enriched rows travelled on their own only because they are
// `enrichment='source'` — values the ДФЗ crawler parsed out of its own snapshot, so the loader
// carries them. Nothing carries `auto` or `reviewed`. This tool is that missing carrier.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// TWO RULES SHAPE THE WHOLE FILE.
//
// 1. NEVER DOWNGRADE. The target may hold a promotion this source has never seen — somebody
//    read the documents against prod, which is exactly what CLAUDE.md tells them to do. So the
//    write is guarded by the SAME total order the loader uses (`ENRICHMENT_RANK`, imported, not
//    restated): a row whose stored provenance OUTRANKS the incoming one is left alone and
//    reported. A tie is not a downgrade and the source wins it — that is the loader's rule too,
//    and it is what lets a re-gated `auto` refresh its own meta.
//
// 2. THE CRAWL OWNS ROW EXISTENCE; THIS TOOL OWNS ONLY THE OVERLAY. A source row with no
//    counterpart on the target is REPORTED, never inserted. Inserting would mint a row from a
//    vintage of the snapshot the target has not loaded, so its title, deadline and docs would
//    come from here rather than from the crawl — and 142's `open_calls_exact_has_close` family
//    would be enforcing shape on a row nobody crawled. The fix for a missing row is
//    `db:load:open-calls:pg:cloud`, then re-run this.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// THE OVERLAY IS COPIED AS A UNIT, NOT MERGED PER COLUMN. `beneficiaries_raw` and the four
// money columns are written together with the flag that vouches for them, NULLs included — a
// per-column COALESCE would leave a row whose `enrichment` says „a human signed off on these
// figures" over a set of figures assembled from two different provenances. The flag is a claim
// about the SET, so the set moves together.
//
// NO CHANGELOG ROW, deliberately (feedback_pg_changelog_required is about ingests). Nothing is
// ingested here: these rows were already counted by the loader's own batch on the source, and
// stamping a second batch on the target would report the same enrichments to /data/updates as
// newly discovered — twice, once per database.

import { pathToFileURL } from "node:url";
import { Pool } from "pg";
// Imported for LOCAL_DATABASE_URL *and* for its import side effect: it points node-pg's .pgpass
// lookup at the repo-local file, which is the only way the password-less Cloud SQL proxy URL
// authenticates. Dialing the proxy without importing this fails with a bare SASL error.
import { LOCAL_DATABASE_URL, isServingUrl, redactUrl } from "../db/lib/pg";
import { ENRICHMENT_RANK, enrichmentRank } from "../db/load_open_calls_pg";
import { MONEY_FIELDS } from "./enrich_apply";

/** The provenances worth carrying. 'source' is excluded because the loader already carries it
 *  (the crawler parses it out of the committed snapshot, so both databases derive it from the
 *  same file), and 'none' is the absence of an overlay. */
export const CARRIED = ["auto", "reviewed"] as const;

/**
 * THE OVERLAY, DERIVED FROM THE WRITER RATHER THAN RESTATED.
 *
 * `MONEY_FIELDS` is `enrich_apply.ts`'s own list — the same tie `load_open_calls_pg.test.ts`
 * uses — so a fifth money column added to Stage 7 joins this payload automatically. Restating
 * the four names here is the shape of the defect this file is meant to close: a column enriched
 * on one database and silently left behind on the other, with every row count reconciling.
 *
 * `enrichment` leads the list because it is the flag the other columns are only admissible
 * under; `enrichment_meta` carries the verbatim quotes, which are the entire evidence for an
 * `auto` row and the thing a human reads before promoting.
 */
export const PAYLOAD_COLS = [
  "enrichment",
  "enrichment_meta",
  "beneficiaries_raw",
  ...MONEY_FIELDS,
] as const;

const KEY_COLS = ["source", "source_key"] as const;
const ALL_COLS = [...KEY_COLS, ...PAYLOAD_COLS];

export interface EnrichmentRow {
  source: string;
  source_key: string;
  enrichment: string;
  [col: string]: unknown;
}

export type Action = "update" | "preserved" | "unchanged" | "missing";

export interface PlanRow {
  source: string;
  sourceKey: string;
  action: Action;
  /** The target's provenance, or null when the target has no such row. */
  from: string | null;
  /** The source's provenance. */
  to: string;
  /** Payload columns whose value differs. Empty for `missing` (nothing to compare against). */
  changed: string[];
}

const key = (r: { source: string; source_key: string }): string =>
  `${r.source}:${r.source_key}`;

/** Order-insensitive deep equality via a canonical rendering.
 *
 *  `enrichment_meta` arrives from node-pg as a parsed object, and two jsonb values with the same
 *  content are not reliably the same JS key order across servers — so a bare `JSON.stringify`
 *  comparison would classify identical metas as changed and rewrite the whole overlay on every
 *  run. Harmless but dishonest: the dry run would report work that does not exist. */
const canonical = (v: unknown): string => {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.entries(v as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`)
    .join(",")}}`;
};

/** Does the STORED provenance outrank the INCOMING one? The never-downgrade predicate, in
 *  TypeScript, over the same map the SQL guard is generated from. */
export const outranks = (stored: string, incoming: string): boolean =>
  (ENRICHMENT_RANK[stored] ?? 0) > (ENRICHMENT_RANK[incoming] ?? 0);

/**
 * What the sync WOULD do — pure, so the never-downgrade rule is testable without two databases.
 *
 * `opts.outranks` is injectable for exactly one reason: a test that asserts „a reviewed target
 * survived an auto source" proves nothing unless it can also show the row would have been
 * updated with the guard removed. Passing a broken predicate is how that mutation is expressed.
 */
export const planSync = (
  source: EnrichmentRow[],
  target: EnrichmentRow[],
  opts: { outranks?: (stored: string, incoming: string) => boolean } = {},
): PlanRow[] => {
  const beats = opts.outranks ?? outranks;
  const byKey = new Map(target.map((r) => [key(r), r]));
  return source.map((s) => {
    const base = {
      source: s.source,
      sourceKey: s.source_key,
      to: s.enrichment,
    };
    const t = byKey.get(key(s));
    // The crawl owns row existence — reported, never inserted. See the header.
    if (!t)
      return { ...base, action: "missing" as const, from: null, changed: [] };

    const changed = PAYLOAD_COLS.filter(
      (c) => canonical(s[c]) !== canonical(t[c]),
    );
    // Rule 1, and it is checked BEFORE „nothing changed": a preserved row must be reported as
    // preserved even when the two happen to agree on every other column, or the one state this
    // tool exists to protect would be invisible in its own report.
    if (beats(t.enrichment, s.enrichment))
      return {
        ...base,
        action: "preserved" as const,
        from: t.enrichment,
        changed,
      };
    if (!changed.length)
      return {
        ...base,
        action: "unchanged" as const,
        from: t.enrichment,
        changed,
      };
    return { ...base, action: "update" as const, from: t.enrichment, changed };
  });
};

/**
 * The write. Exported so its guards are asserted rather than described — the `AUTO_WRITE_SQL`
 * pattern from `enrich_apply.ts`.
 *
 * THREE THINGS, each load-bearing:
 *  - keyed on the FULL unique key `(source, source_key)`, never `source_key` alone;
 *  - the rank guard is in the SQL, not only in `planSync`. The plan is computed from a read
 *    taken seconds earlier, so a promotion landing on the target in between would otherwise be
 *    overwritten by a stale decision. It also means the rule survives anyone calling this
 *    statement without the planner;
 *  - `RETURNING`, so the caller counts writes that LANDED. Without it, „synced 7" was reachable
 *    with the guard having refused all seven.
 */
export const updateSql = (): string => {
  // $1 source, $2 source_key, then one param per payload column in PAYLOAD_COLS order.
  const sets = PAYLOAD_COLS.map((c, i) =>
    c === "enrichment_meta" ? `${c} = $${i + 3}::jsonb` : `${c} = $${i + 3}`,
  );
  const incoming = `$${PAYLOAD_COLS.indexOf("enrichment") + 3}::text`;
  return `UPDATE open_calls
             SET ${sets.join(", ")}
           WHERE source = $1 AND source_key = $2
             AND ${enrichmentRank("enrichment")} <= ${enrichmentRank(incoming)}
          RETURNING source_key`;
};

const params = (r: EnrichmentRow): unknown[] => [
  r.source,
  r.source_key,
  ...PAYLOAD_COLS.map((c) =>
    c === "enrichment_meta" ? JSON.stringify(r[c] ?? {}) : (r[c] ?? null),
  ),
];

/**
 * Run the approved plan, counting writes that LANDED.
 *
 * Extracted from the CLI and given an injected `query` for one reason: the `refused` branch is
 * the branch that decides whether „Wrote N" is truthful, and it fires only when the SQL guard
 * rejects a row the plan approved — i.e. under a race between the read and the write. A real
 * run will essentially never exercise it again, so without a test it is asserted by nothing.
 * An over-counting version of exactly this loop has existed before: see `updateSql`'s note on
 * why the statement RETURNs at all.
 */
export const applyPlan = async (
  todo: PlanRow[],
  sourceRows: EnrichmentRow[],
  query: (sql: string, p: unknown[]) => Promise<{ rowCount: number | null }>,
): Promise<{ written: number; refused: string[] }> => {
  let written = 0;
  const refused: string[] = [];
  const sql = updateSql();
  for (const p of todo) {
    const row = sourceRows.find(
      (r) => r.source === p.source && r.source_key === p.sourceKey,
    );
    if (!row) continue;
    const res = await query(sql, params(row));
    // RETURNING, not an optimistic counter: a row the plan approved can still be refused by the
    // SQL guard if the target moved. That is the rule working, but it must be REPORTED — a
    // silent skip here is the same class of failure as the one this whole tool exists to end.
    if (res.rowCount) written++;
    else refused.push(`${p.source}/${p.sourceKey}`);
  }
  return { written, refused };
};

const SELECT_ENRICHED = `SELECT ${ALL_COLS.join(", ")}
    FROM open_calls
   WHERE enrichment = ANY($1::text[])
   ORDER BY source, source_key`;

/** The target side: the counterparts of the source's keys, PLUS every row the target has
 *  enriched on its own. The second half is what makes divergence visible — a promotion done
 *  against prod is precisely the row the never-downgrade rule protects, and an operator should
 *  be told it exists rather than left to infer it from a silence. */
const SELECT_TARGET = `SELECT ${ALL_COLS.join(", ")}
    FROM open_calls
   WHERE enrichment = ANY($1::text[])
      OR (source, source_key) IN (SELECT * FROM unnest($2::text[], $3::text[]))
   ORDER BY source, source_key`;

/** Never print a password, even one from .pgpass that is not in the URL.
 *  Re-exported from lib/pg, which owns connection URLs and is now the one definition —
 *  this alias keeps the existing name for callers and for sync_enrichment.test.ts. */
export const redact = redactUrl;

/** A flag's value, REFUSING the two shapes that silently mean something else.
 *
 *  `--from` as the last argument yields undefined, which falls back to LOCAL_DATABASE_URL: the
 *  operator asked for one source and got another, with nothing said. `--to --apply` yields
 *  "--apply" as a connection string, which surfaces as an obscure node-pg dial error rather
 *  than as „you forgot the URL". */
const flagValue = (argv: string[], name: string): string | undefined => {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (!v || v.startsWith("--"))
    throw new Error(
      `${name} needs a connection URL, e.g. ${name} ${LOCAL_DATABASE_URL}`,
    );
  return v;
};

const tableExists = async (pool: Pool, label: string): Promise<void> => {
  const { rows } = await pool.query<{ t: string | null }>(
    "SELECT to_regclass('public.open_calls')::text t",
  );
  if (!rows[0]?.t)
    throw new Error(
      `${label}: no open_calls table (migration 142 never applied there).\n` +
        `  Run: npm run db:load:open-calls:pg${label === "target" ? ":cloud" : ""}`,
    );
};

/** WHICH DATABASE IS THIS, REGARDLESS OF HOW IT WAS SPELLED.
 *
 *  `system_identifier` distinguishes CLUSTERS (it is stamped at initdb), `current_database()`
 *  distinguishes databases within one. Asked over the connection itself, so `localhost` vs
 *  `127.0.0.1`, a `?sslmode=` suffix and a trailing slash all resolve to the same answer — which
 *  a string comparison of the two URLs cannot do.
 *
 *  Verified against Cloud SQL 2026-08-09: `pg_control_system()` is readable there even though
 *  its `postgres` role is NOT a superuser (`usesuper = false`), so this does not need a
 *  privilege the serving database withholds.
 *
 *  Returns null rather than throwing when it cannot be read, because `--to` is free-form and a
 *  managed Postgres that restricts `pg_control_system()` would otherwise make this guard abort
 *  every legitimate sync. Degrading is right here and only here: the caller SAYS the check was
 *  skipped, so the operator loses a safety net loudly rather than silently — which is the
 *  opposite of the failure the guard exists to prevent. */
const identity = async (pool: Pool): Promise<string | null> => {
  try {
    const { rows } = await pool.query<{ id: string }>(
      "SELECT system_identifier::text || '/' || current_database() id FROM pg_control_system()",
    );
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
};

export const syncEnrichment = async (argv: string[]): Promise<void> => {
  const apply = argv.includes("--apply");
  const from = flagValue(argv, "--from") ?? LOCAL_DATABASE_URL;
  const to = flagValue(argv, "--to") ?? process.env.DATABASE_URL;
  if (!to)
    throw new Error(
      "no target: pass --to <url>, or use `npm run opencalls:sync-enrichment:cloud`, " +
        "which sets DATABASE_URL to the Cloud SQL proxy.",
    );
  // A same-database sync is a no-op that reports „0 rows to update" — indistinguishable from
  // „the target is already current", which is the answer an operator is hoping for. Refuse.
  // This cheap form fails before opening any connection; the authoritative one is below, since
  // the same database has many spellings and a guard defeated by spelling is not a guard.
  if (from === to)
    throw new Error(
      `source and target are the same database (${redact(from)}). ` +
        "Nothing would be copied, and the report would read as success.",
    );

  const src = new Pool({ connectionString: from, max: 2 });
  const tgt = new Pool({ connectionString: to, max: 2 });
  // A Pool with no 'error' listener CRASHES the process ("Unhandled 'error' event") when an
  // IDLE backend connection drops — the Cloud SQL proxy does exactly this, and getPool()
  // carries the same handler for the same reason. It matters more here than anywhere else in
  // the repo: this is the only raw-pool site that issues a SEQUENCE OF WRITES to the serving
  // database while holding a second idle pool open, so a drop mid-loop would kill the process
  // after some rows had already committed — losing the „Wrote N row(s)" line that is this
  // tool's entire report of what landed.
  for (const [label, p] of [
    ["source", src],
    ["target", tgt],
  ] as const)
    p.on("error", (err) =>
      console.error(
        `[pg] ${label}: idle client error (dropped, pool recovered):`,
        err.message,
      ),
    );
  try {
    console.log(`source: ${redact(from)}`);
    console.log(
      `target: ${redact(to)}${isServingUrl(to) ? "   ← SERVES PRODUCTION" : ""}\n`,
    );
    await tableExists(src, "source");
    await tableExists(tgt, "target");

    // The authoritative same-database check: ask both connections who they are.
    const [srcId, tgtId] = await Promise.all([identity(src), identity(tgt)]);
    if (srcId && tgtId && srcId === tgtId)
      throw new Error(
        `source and target are the same database — ${redact(from)} and ${redact(to)} ` +
          `both resolve to ${tgtId}. Nothing would be copied, and the report would read as ` +
          "success.",
      );
    if (!srcId || !tgtId)
      console.log(
        "note: could not read pg_control_system() on " +
          `${!srcId ? "the source" : "the target"} — the two URLs differ as strings, but ` +
          "whether they name the same database was NOT verified.\n",
      );

    const carried = [...CARRIED];
    const sourceRows = (
      await src.query<EnrichmentRow>(SELECT_ENRICHED, [carried])
    ).rows;
    if (!sourceRows.length) {
      console.log(
        `The source holds no ${carried.join("/")} row — nothing to sync.\n` +
          "(`source` provenance is carried by db:load:open-calls:pg:cloud; only these two are not.)",
      );
      return;
    }
    const targetRows = (
      await tgt.query<EnrichmentRow>(SELECT_TARGET, [
        carried,
        sourceRows.map((r) => r.source),
        sourceRows.map((r) => r.source_key),
      ])
    ).rows;

    const plan = planSync(sourceRows, targetRows);
    const of = (a: Action) => plan.filter((p) => p.action === a);

    for (const p of plan) {
      const head = `${p.source}/${p.sourceKey}`;
      if (p.action === "missing")
        console.log(
          `  MISSING  ${head}\n` +
            `           no such row on the target — the crawl owns row existence, so this is` +
            ` not inserted.\n` +
            `           Run db:load:open-calls:pg:cloud first, then re-run this.`,
        );
      else if (p.action === "preserved")
        // The payload difference is printed HERE and nowhere else, because a preserved row is
        // exactly the row where it is interesting: a 'reviewed' target against an 'auto' source
        // carrying newly re-gated quotes means the source holds fresher evidence than the
        // promotion was made from, and the operator is the only one who can act on that.
        console.log(
          `  KEPT     ${head}   target '${p.from}' outranks source '${p.to}' — left alone` +
            (p.changed.length
              ? `   (source differs on: ${p.changed.join(", ")})`
              : ""),
        );
      else if (p.action === "unchanged")
        console.log(`  same     ${head}   '${p.to}', already identical`);
      else
        console.log(
          `  ${p.from === p.to ? "REFRESH " : "UPDATE  "} ${head}   '${p.from}' → '${p.to}'` +
            `   [${p.changed.join(", ")}]`,
        );
    }

    // Rows the TARGET enriched and the source has never seen. Not an error and not actionable
    // here — the point is that the operator learns the two databases have diverged, rather than
    // discovering it the next time somebody wonders why prod holds a figure local does not.
    const sourceKeys = new Set(sourceRows.map(key));
    const onlyOnTarget = targetRows.filter(
      (r) =>
        (carried as string[]).includes(r.enrichment) && !sourceKeys.has(key(r)),
    );
    if (onlyOnTarget.length) {
      console.log(
        `\n${onlyOnTarget.length} row(s) enriched on the TARGET only — untouched by this tool:`,
      );
      for (const r of onlyOnTarget)
        console.log(`  ${r.source}/${r.source_key}   '${r.enrichment}'`);
    }

    const todo = of("update");
    console.log(
      `\n${plan.length} enriched row(s) on the source: ` +
        `${todo.length} to write, ${of("unchanged").length} already identical, ` +
        `${of("preserved").length} preserved, ${of("missing").length} missing on the target.`,
    );

    // INCOMPLETE IS NOT SUCCESS. Both outcomes mean the sync did not fully happen, so a wrapper
    // or a watch-skill step can tell them apart without parsing stdout. This fires on a DRY RUN
    // too, and deliberately: a dry run's job is to report whether a full sync is POSSIBLE, and
    // a missing row means it is not until the loader has run against the target.
    if (of("missing").length) process.exitCode = 1;

    if (!apply) {
      console.log(
        todo.length
          ? "\nDry run — nothing written. Add --apply to write."
          : "\nDry run — and there is nothing to write.",
      );
      return;
    }
    if (!todo.length) {
      console.log("\nNothing to write.");
      return;
    }

    const { written, refused } = await applyPlan(todo, sourceRows, (sql, p) =>
      tgt.query(sql, p),
    );
    for (const r of refused)
      console.log(
        `  REFUSED  ${r}   the target's provenance rose between the read and the write`,
      );
    if (refused.length) process.exitCode = 1;
    console.log(`\nWrote ${written} row(s) to ${redact(to)}.`);
  } finally {
    await Promise.all([src.end(), tgt.end()]);
  }
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  syncEnrichment(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
