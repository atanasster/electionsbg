// Load the КЗК decisions corpus into `kzk_decisions` (migration 130).
//
//   npm run db:load:kzk-decisions:pg                    (needs `npm run db:pg:up`)
//   npm run db:load:kzk-decisions:pg:cloud              (against the Cloud SQL proxy)
//   npm run db:load:kzk-decisions:pg -- --allow-shrink  (see the shrink guard below)
//
// Reads data/procurement/kzk_decisions.json and ships it. Both migrations it needs
// (005 for the changelog tables, 130 for the corpus) are applied by this loader,
// so a fresh DB needs nothing else.
//
// TWO GUARDS STAND IN FRONT OF THE MERGE, and they are the most important lines
// in this file. `mergeFromStage` runs an anti-join DELETE — every live act the
// current build did not produce is removed. That is correct for a derived table
// and DANGEROUS here, because this table plus the gitignored JSON are the only
// copies of a corpus with no committed generator (until T4's backfill is proven).
// A rejection spike from source drift, or a year-scoped/partial JSON, would
// otherwise delete the difference and exit 0. So:
//
//   * a rejection RATE above REJECT_RATE_CEILING is treated as parser/source
//     drift and refuses to merge at all (the known-historical damage is 8.9%);
//   * a build that would SHRINK the table by more than SHRINK_TOLERANCE aborts
//     unless the operator passes --allow-shrink.
//
// Both fail before the transaction opens, so a bad run costs nothing.
//
// WHY THIS TABLE EXISTS AT ALL — see the header of 130_kzk_decisions.sql. The
// short version: the freshness gate cannot anchor on
// `max(kzk_appeals.decision_date)`, because 1,838 of 4,836 decisions match no
// appeal, so that column legitimately lags the register. It anchors here.
//
// STAGE MERGE, not TRUNCATE+COPY. This table is on a serving path the moment the
// gate and the matcher read it, and a TRUNCATE holds an AccessExclusiveLock for
// the whole load — the failure documented in reference_stage_merge_reload. At
// 4.4k rows the rebuild is instant either way; the point is that the pattern
// cannot rot into a 500 when the corpus grows.
//
// THE 429. The 2026-07-04 corpus carries 429 column-shifted rows (act text in the
// act-number field, blank date). They are rejected, COUNTED and reported here
// rather than loaded — a row with no date can never match an appeal and can never
// move the gate, so storing it would only inflate the corpus. See
// scripts/procurement/kzk_decisions_store.ts for the signature and why the same
// validator runs inside the crawler.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, exec, withTx, end } from "./lib/pg";
import { copyRows } from "./lib/copy";
import { recordIngestBatch } from "./lib/ingest_changelog";
import {
  createStageTable,
  addStagePrimaryKey,
  mergeFromStage,
  type StageMergeSpec,
} from "./lib/stage_merge";
import {
  DECISIONS_LIST_URL,
  validateDecisions,
  summarizeRejections,
  type DecisionsFile,
} from "../procurement/kzk_decisions_store";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
// 005 creates ingest_batches / ingest_first_seen / changelog_days, which
// recordIngestBatch writes INSIDE the load transaction — so on a DB without it
// the whole merge rolls back and the load silently accomplishes nothing but
// applying the DDL. Every sibling loader that records a batch applies it first.
const TRACKING = path.join(
  __dirname,
  "schema",
  "pg",
  "005_ingest_tracking.sql",
);
const MIGRATION = path.join(__dirname, "schema", "pg", "130_kzk_decisions.sql");

/** Above this share of rejected rows, assume parser/source drift and refuse. */
const REJECT_RATE_CEILING = 0.15;
/** A build smaller than this share of the live table needs --allow-shrink. */
const SHRINK_TOLERANCE = 0.95;
const SOURCE_FILE = path.join(
  ROOT,
  "data",
  "procurement",
  "kzk_decisions.json",
);

const SPEC: StageMergeSpec = {
  table: "kzk_decisions",
  source: "kzk_decisions_stage",
  keys: ["act_no"],
  cols: [
    "act_no",
    "decision_date",
    "pronouncement",
    "kzk_case_no",
    "initiators",
    "respondent",
    "source_url",
    "fetched_at",
  ],
};

const nullIfBlank = (v: string | null | undefined): string | null => {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
};

const main = async (): Promise<void> => {
  const allowShrink = process.argv.includes("--allow-shrink");

  console.log("→ applying 005_ingest_tracking.sql + 130_kzk_decisions.sql…");
  await exec(readFileSync(TRACKING, "utf8"));
  await exec(readFileSync(MIGRATION, "utf8"));

  if (!existsSync(SOURCE_FILE)) {
    // Not an error: a fresh clone has no corpus (it is gitignored and the crawl
    // needs BG egress). Leave the table as the migration created it and say so —
    // kzk_decisions.data.test.ts is what fails on the resulting empty table, and
    // it should fail there rather than here, where it would block `db:refresh`.
    console.log(
      `  No ${path.relative(ROOT, SOURCE_FILE)} — nothing to load.\n` +
        "  Build it with `npx tsx scripts/procurement/kzk_decisions.ts --year <YYYY> --apply`\n" +
        "  (T4 — needs a headed browser + Bulgarian egress).",
    );
    await end();
    return;
  }

  const file = JSON.parse(readFileSync(SOURCE_FILE, "utf8")) as DecisionsFile;
  const all = file.decisions ?? [];
  const { clean, rejected } = validateDecisions(all);

  console.log(
    `→ ${all.length} decisions in the corpus (generated ${file.generatedAt ?? "?"})`,
  );
  if (rejected.length) {
    console.log(
      `  ⚠ rejecting ${rejected.length} malformed row(s) — not loaded:`,
    );
    for (const { reason, count } of summarizeRejections(rejected))
      console.log(`      ${count}× ${reason}`);
  }
  if (clean.length === 0) {
    throw new Error(
      "every decision row was rejected — the corpus or the parser is broken, " +
        "refusing to merge an empty build over a populated table",
    );
  }

  // GUARD 1 — a rejection SPIKE is source/parser drift, not the known-historical
  // 8.9%. Refuse before the merge rather than reporting the damage after the
  // anti-join has already deleted every act the short build omitted.
  const rejectRate = all.length ? rejected.length / all.length : 0;
  if (rejectRate > REJECT_RATE_CEILING) {
    throw new Error(
      `${rejected.length}/${all.length} rows rejected (${(rejectRate * 100).toFixed(1)}%) — ` +
        `far above the known-historical 8.9%. That is source drift, not old damage. ` +
        "Fix the parser; refusing to merge (the merge DELETEs acts this build omits).",
    );
  }

  // GUARD 2 — the merge's anti-join deletes what the build omits. On the ONLY
  // copy of an irreplaceable corpus that must be opt-in, never a side effect of a
  // short or year-scoped file.
  const live = Number(
    (await allRows<{ n: string }>("SELECT count(*) n FROM kzk_decisions"))[0]
      ?.n ?? 0,
  );
  if (live > 0 && clean.length < live * SHRINK_TOLERANCE && !allowShrink) {
    throw new Error(
      `refusing to shrink kzk_decisions ${live} → ${clean.length} acts: the merge would ` +
        `DELETE ${live - clean.length} rows, and this table plus the gitignored JSON are ` +
        "the only copies. Re-run with --allow-shrink if the shrink is intended.",
    );
  }

  console.log(`→ loading ${clean.length} well-formed decisions…`);

  // Deliberately NOT `?? new Date().toISOString()`. A wall-clock fallback would
  // restamp fetched_at on every row every run, which defeats stageUpsertSql's
  // `IS DISTINCT FROM` churn guard (lib/stage_merge.ts calls it load-bearing) and
  // would make any future "what changed" diff report the whole corpus as modified.
  if (!file.generatedAt) {
    throw new Error(
      `${path.relative(ROOT, SOURCE_FILE)} has no generatedAt — refusing to stamp ` +
        "fetched_at with wall-clock time, which would rewrite every row on every load",
    );
  }
  const fallbackFetchedAt = file.generatedAt;

  await withTx(async (c) => {
    await createStageTable(c, SPEC);
    const n = await copyRows(
      c,
      SPEC.source,
      SPEC.cols,
      clean.map((d) => [
        d.no,
        d.ddate,
        nullIfBlank(d.pron),
        nullIfBlank(d.kzk),
        nullIfBlank(d.init),
        nullIfBlank(d.resp),
        // Per-row provenance when the crawler recorded it; the решения list URL
        // otherwise. Once the определения register lands (plan §3c) those rows
        // carry their own URL and must not be stamped with this one.
        nullIfBlank(d.sourceUrl) ?? DECISIONS_LIST_URL,
        d.fetchedAt ?? fallbackFetchedAt,
      ]),
    );
    await addStagePrimaryKey(c, SPEC);
    await mergeFromStage(c, SPEC);
    await c.query(`DROP TABLE IF EXISTS ${SPEC.source}`);
    await c.query("ANALYZE kzk_decisions");

    // "What changed" changelog, atomic with the load, keyed on the act number
    // (stable across re-crawls). See [[feedback_pg_changelog_required]].
    await recordIngestBatch(c, {
      source: "kzk_decisions",
      table: "kzk_decisions",
      keyExpr: "t.act_no",
      nameExpr: "t.respondent",
      detailExpr: "t.pronouncement",
      rowsTotal: n,
    });
  });

  const newest = clean.reduce((a, d) => (d.ddate > a ? d.ddate : a), "");
  console.log(
    `✓ kzk_decisions: ${clean.length} acts, newest ${newest}.\n` +
      "  Fold any newly-loaded decisions into kzk_appeals.outcome with\n" +
      "  `npx tsx scripts/procurement/kzk_rejoin.ts --apply` (T2).\n" +
      "\n" +
      "  ⚠ THIS CORPUS IS NOT YET REPRODUCIBLE. Until a full\n" +
      "    `kzk_decisions.ts --backfill --dry-run` is proven to re-derive it, this\n" +
      "    table plus data/procurement/kzk_decisions.json are the ONLY copies, and\n" +
      "    the JSON is gitignored. Take a restore point now:\n" +
      "        npm run db:dump\n" +
      "    'Never regress the 2,098' is a rule, not a recovery plan.",
  );
  await end();
};

main().catch(async (e) => {
  console.error(e);
  await end().catch(() => undefined);
  process.exit(1);
});
