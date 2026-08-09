// Load the committed open-calls snapshots into `open_calls` (migration 142).
//
//   npm run db:load:open-calls:pg           (needs `npm run db:pg:up`)
//   npm run db:load:open-calls:pg:cloud     (against the Cloud SQL proxy)
//
// Reads data/opencalls/<source>.json — the artifacts `npm run opencalls:isun` and
// `opencalls:sp2023` write. Both migrations it needs (005 for the changelog tables, 142 for
// the corpus) are applied here, so a cold database needs nothing else.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// UPSERT ONLY. THE MOST IMPORTANT LINE IN THIS FILE IS THE ONE THAT IS NOT HERE.
//
// Every sibling loader in this repo calls `mergeFromStage`, which upserts and then ANTI-JOIN
// DELETES every live key the build did not produce. That is right for a derived table and
// catastrophic here: the crawler reads ИСУН's /Active tier, so a call that CLOSES simply
// stops being listed. An anti-join delete would therefore erase precisely the closed calls
// that make base rates, „затвори наскоро" and the archive possible — silently, at exit 0.
//
// So this uses `stageUpsertSql` alone. Absence is recorded by NOT refreshing `last_seen_at`,
// never by deleting. Nothing in this file may grow a DELETE without re-reading migration
// 142's header first.
//
// The table cannot shrink, which also means it needs no shrink guard: the guard that matters
// lives in write_snapshot.ts, where a bad crawl could overwrite the committed archive.
// ─────────────────────────────────────────────────────────────────────────────────────────
//
// ONE HONEST CAVEAT ON "never blocking": `applySchema` runs 142's DDL on every load, and its
// idempotent `ALTER TABLE … ADD CONSTRAINT` block takes a brief AccessExclusiveLock on
// `open_calls` before any rows move. It is milliseconds on 66 rows, but it is not zero — the
// lock-free claim below is about the MERGE, not about the schema pass.
//
// STAGE MERGE, not TRUNCATE+COPY. `open_calls` is on a serving path from the moment
// /api/db/open-calls ships, and TRUNCATE holds an AccessExclusiveLock for the whole load —
// the failure documented in reference_stage_merge_reload (readers 55P03 at the pool's 2 s
// lock_timeout). The upsert takes only RowExclusiveLock, so readers keep serving the previous
// vintage and flip at COMMIT.
//
// `first_seen_at` IS DELIBERATELY ABSENT FROM `cols`. It is the column that answers „ново" —
// including it in the merge would reset it on every run, so every call would be new for ever.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { allRows, exec, withTx, end } from "./lib/pg";
import { copyRows, pgTextArray } from "./lib/copy";
import { recordIngestBatch } from "./lib/ingest_changelog";
import {
  createStageTable,
  addStagePrimaryKey,
  type StageMergeSpec,
} from "./lib/stage_merge";
import type { OpenCall, OpenCallsSnapshot } from "../opencalls/types";
import { AUDIENCES, validateCall } from "../opencalls/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(here, "..", "..");
const SNAPSHOT_DIR = path.join(REPO, "data", "opencalls");
const SCHEMA_DIR = path.join(here, "schema", "pg");

/** Which snapshots to load. A source with no file is SKIPPED WITH A WARNING rather than
 *  failing the run: ahu/az are Stage 8 and do not exist yet, and a fresh clone legitimately
 *  has only what is committed. */
const SOURCES: OpenCall["source"][] = ["isun", "sp2023", "ahu", "az"];

/** Above this share of structurally invalid rows, treat the snapshot as drift and refuse.
 *  Same posture as load_kzk_decisions_pg.ts. */
const MAX_REJECT_RATE = 0.15;

const SPEC: StageMergeSpec = {
  table: "open_calls",
  source: "open_calls_stage",
  keys: ["source", "source_key"],
  cols: [
    "source",
    "source_key",
    "code",
    "kind",
    "title",
    "programme_code",
    "programme_name",
    "objective",
    "date_precision",
    "opens_at",
    "closes_at",
    "period_label",
    "budget_eur",
    "budget_note",
    "aid_rate_pct",
    "grant_min_eur",
    "grant_max_eur",
    "beneficiaries_raw",
    "audience",
    "territory",
    "source_url",
    "docs",
    "enrichment",
    // Refreshed on every load: this row was listed by THIS crawl.
    "last_seen_at",
    "checked_at",
    // NOT first_seen_at — see the header.
  ],
};

/** Columns the SOURCE is authoritative for: always overwritten from the incoming row. */
export const SOURCE_OWNED = [
  "code",
  "kind",
  "title",
  "programme_code",
  "programme_name",
  "objective",
  "date_precision",
  "opens_at",
  "closes_at",
  "period_label",
  "audience",
  "territory",
  "source_url",
  "docs",
  "last_seen_at",
  "checked_at",
] as const;

/** Columns a crawl may FILL but must never BLANK.
 *
 *  Stage 7 (`enrich-open-calls`) writes a human-reviewed figure into these. A generic upsert
 *  would reset them to the incoming NULL on the very next crawl — silently, with
 *  `enrichment_meta` (not in this list) left behind as evidence of a promotion that no longer
 *  exists, and every row count reconciling. COALESCE keeps the stored value when the source
 *  offers nothing.
 *
 *  `beneficiaries_raw` IS IN THIS LIST AND LOOKS LIKE IT SHOULD NOT BE. It is the one column an
 *  `enrichment='auto'` extraction may fill, so it is enrichment-written for ИСУН — but the ДФЗ
 *  (`sp2023`) snapshot carries a real eligibility line of its own, so it is ALSO source-written.
 *  Neither owner can be given the column outright, and fill-never-blank is the rule that suits
 *  both: ДФЗ keeps overwriting its own value, and ИСУН's NULL stops erasing the enriched one.
 *  MEASURED 2026-08-09, which is why this note exists: with it in SOURCE_OWNED, a single
 *  ordinary `db:load:open-calls:pg` took a promoted row from its eligibility text to NULL while
 *  leaving `enrichment='reviewed'` and the quotes in the meta — a row asserting that a human
 *  signed off on text that is no longer there. */
export const FILL_NEVER_BLANK = [
  "budget_eur",
  "budget_note",
  "aid_rate_pct",
  "grant_min_eur",
  "grant_max_eur",
  "beneficiaries_raw",
] as const;

/** Provenance strength, as SQL. A crawl may RAISE a row's provenance and may never LOWER it.
 *
 *  A rank rather than a list of names, because the first two drafts of this rule were both
 *  incomplete in a way that reads as correct. Guarding only `IN ('reviewed','source')` let an
 *  'auto' row fall back to 'none', orphaning its extraction. Guarding only `EXCLUDED = 'none'`
 *  then left two live holes: `reviewed → source` is a silent downgrade of a human's decision to
 *  a machine's, and `reviewed → auto` would set 'auto' on a row that still holds money, which
 *  142's open_calls_money_needs_provenance CHECK rejects — aborting the WHOLE load, not the row.
 *  A total order cannot have a hole. */
const rank = (col: string): string =>
  `CASE ${col} WHEN 'reviewed' THEN 3 WHEN 'source' THEN 2 WHEN 'auto' THEN 1 ELSE 0 END`;

/** The upsert, written out because this table's columns have three different update rules.
 *
 *  `enrichment` is the subtle one: it must not downgrade. A human 'reviewed' promotion survives
 *  a crawl, and so does a 'source' provenance whose figures we are COALESCE-preserving — if the
 *  flag fell to 'none' while the money stayed, migration 142's
 *  open_calls_money_needs_provenance CHECK would reject the row outright.
 *
 *  'auto' is preserved for a different reason: it has no money to violate the CHECK, but it does
 *  have a gated extraction in `enrichment_meta`, and downgrading the flag alone would leave the
 *  meta orphaned, put the row back in the review queue, and spend the tokens to read the same
 *  document again. See `rank()` above for why the comparison is an order and not a name list.
 *
 *  THE LIMIT OF THIS, STATED: the crawl carries no signal that a procedure's DOCUMENT changed
 *  (ИСУН re-issues „Условия за кандидатстване - изменени" under the same GUID), so a preserved
 *  extraction can outlive the text it was drawn from. Detecting that needs a `docs` hash the
 *  crawler does not yet store. Preserving matches what 'reviewed' already does — a human's
 *  decision outlives a re-issue until someone re-checks it — but it is a choice, not a
 *  guarantee. */
export const upsertSql = (): string => {
  const sets = [
    ...SOURCE_OWNED.map((c) => `${c} = EXCLUDED.${c}`),
    ...FILL_NEVER_BLANK.map(
      (c) => `${c} = COALESCE(EXCLUDED.${c}, open_calls.${c})`,
    ),
    `enrichment = CASE WHEN ${rank("open_calls.enrichment")} > ${rank("EXCLUDED.enrichment")}
                       THEN open_calls.enrichment ELSE EXCLUDED.enrichment END`,
  ];
  return `INSERT INTO ${SPEC.table} (${SPEC.cols.join(", ")})
          SELECT ${SPEC.cols.join(", ")} FROM ${SPEC.source}
          ON CONFLICT (${SPEC.keys.join(", ")}) DO UPDATE SET ${sets.join(", ")}`;
};

const applySchema = async (): Promise<void> => {
  for (const f of ["005_ingest_tracking.sql", "142_open_calls.sql"]) {
    const p = path.join(SCHEMA_DIR, f);
    if (!existsSync(p)) throw new Error(`missing migration ${f}`);
    await exec(readFileSync(p, "utf-8"));
  }
};

interface Loaded {
  source: OpenCall["source"];
  crawledAt: string;
  calls: OpenCall[];
  rejected: string[];
}

const readSnapshots = (): Loaded[] => {
  const out: Loaded[] = [];
  for (const source of SOURCES) {
    const p = path.join(SNAPSHOT_DIR, `${source}.json`);
    if (!existsSync(p)) {
      console.log(`  ${source}: no snapshot — skipping`);
      continue;
    }
    const snap = JSON.parse(readFileSync(p, "utf-8")) as OpenCallsSnapshot;
    const rejected: string[] = [];
    const calls = snap.calls.filter((c) => {
      // validateCall covers the date/shape invariants. The ENUM constraints are checked here
      // too, because a bad enum otherwise sails past it and surfaces as a bare 23514 that
      // aborts BOTH sources while naming no row — the opposite of the "name the offending
      // call" contract write_snapshot.ts claims.
      const bad = [...validateCall(c)];
      if (c.source !== source)
        // Under the no-delete rule this is PERMANENT: rows written under the wrong source can
        // never be removed by a re-run.
        bad.push(`source is "${c.source}" in ${source}.json`);
      if (!["call", "consultation"].includes(c.kind))
        bad.push(`kind "${c.kind}"`);
      if (!["exact", "indicative"].includes(c.datePrecision))
        bad.push(`date_precision "${c.datePrecision}"`);
      if (
        c.enrichment &&
        !["none", "source", "auto", "reviewed"].includes(c.enrichment)
      )
        bad.push(`enrichment "${c.enrichment}"`);
      for (const a of c.audience)
        if (!AUDIENCES.includes(a)) bad.push(`audience "${a}"`);
      if (bad.length) rejected.push(`${c.sourceKey}: ${bad.join("; ")}`);
      return bad.length === 0;
    });
    const total = snap.calls.length;
    if (total === 0)
      throw new Error(`${source}: snapshot has no calls — refusing to load`);
    const rate = rejected.length / total;
    if (rate > MAX_REJECT_RATE)
      throw new Error(
        `${source}: ${rejected.length}/${total} rows invalid (${Math.round(
          rate * 100,
        )}% > ${Math.round(MAX_REJECT_RATE * 100)}%) — source drift, refusing to load:\n  ${rejected
          .slice(0, 5)
          .join("\n  ")}`,
      );
    console.log(
      `  ${source}: ${calls.length} call(s)${rejected.length ? `, ${rejected.length} rejected` : ""} (crawled ${snap.crawledAt})`,
    );
    for (const r of rejected) console.log(`    ! ${r}`);
    out.push({ source, crawledAt: snap.crawledAt, calls, rejected });
  }
  return out;
};

/** One stage row, in `SPEC.cols` order.
 *
 *  `crawledAt` is the SNAPSHOT's timestamp, not the loader's clock. `last_seen_at` means "the
 *  last crawl that still LISTED this row" (142's own words) and it is the ENTIRE absence
 *  mechanism — stamping it with now() would assert on a fresh clone, or on the manual cloud
 *  publish, that a weeks-old snapshot was listed today. `checked_at` is the load time, which is
 *  a different fact and keeps its own column. */
const toRow = (
  c: OpenCall,
  crawledAt: string,
  checkedAt: string,
): unknown[] => [
  c.source,
  c.sourceKey,
  c.code,
  c.kind,
  c.title,
  c.programmeCode,
  c.programmeName,
  c.objective,
  c.datePrecision,
  c.opensAt,
  c.closesAt,
  c.periodLabel,
  c.budgetEur,
  c.budgetNote,
  c.aidRatePct,
  c.grantMinEur,
  c.grantMaxEur,
  c.beneficiariesRaw,
  // The shared helper, which escapes backslashes and quotes and has its own pinned tests —
  // a hand-rolled literal here was a second, untested implementation of the same thing.
  pgTextArray(c.audience),
  c.territory,
  c.sourceUrl,
  JSON.stringify(c.docs ?? []),
  c.enrichment ?? "none",
  crawledAt,
  checkedAt,
];

export const loadOpenCalls = async (): Promise<void> => {
  console.log("applying schema…");
  await applySchema();

  console.log("reading snapshots…");
  const loaded = readSnapshots();
  if (loaded.length === 0)
    throw new Error(
      "no snapshots found under data/opencalls — nothing to load",
    );

  const checkedAt = new Date().toISOString();
  // Each row carries ITS OWN source's crawl time, so two snapshots of different ages do not
  // both claim to have been listed at the newer moment.
  const all = loaded.flatMap((l) =>
    l.calls.map((c) => ({ call: c, crawledAt: l.crawledAt })),
  );

  const before = Number(
    (await allRows<{ n: string }>("SELECT count(*) n FROM open_calls"))[0]?.n ??
      0,
  );

  await withTx(async (c) => {
    await createStageTable(c, SPEC);
    // The stage is created `LIKE open_calls INCLUDING DEFAULTS`, so its `id` inherits
    // nextval(open_calls_id_seq) and every staged row burns a live sequence value it will never
    // use. Nothing reads the stage's id; dropping the default keeps the live sequence honest.
    // …and NOT NULL with it: `id` is not in SPEC.cols, so with the default gone there is
    // nothing to fill it. The stage's PK is (source, source_key), not id, so a null is fine.
    await c.query(
      `ALTER TABLE ${SPEC.source}
         ALTER COLUMN id DROP DEFAULT,
         ALTER COLUMN id DROP NOT NULL`,
    );
    await copyRows(
      c,
      SPEC.source,
      SPEC.cols,
      all.map((x) => toRow(x.call, x.crawledAt, checkedAt)),
    );
    await addStagePrimaryKey(c, SPEC);
    // UPSERT ONLY, and per-column — see upsertSql(). No stageDeleteSql anywhere.
    await c.query(upsertSql());
    await c.query(`DROP TABLE IF EXISTS ${SPEC.source}`);

    // Per-source crawl stamp: what the UI's freshness banner reads. Written even for a source
    // that yielded zero NEW rows, because "we looked and nothing changed" and "we never
    // looked" must stay distinguishable.
    for (const l of loaded)
      await c.query(
        `INSERT INTO open_calls_crawl (source, crawled_at, rows_seen, ok, note)
         VALUES ($1, $2, $3, true, $4)
         ON CONFLICT (source) DO UPDATE SET
           crawled_at = EXCLUDED.crawled_at, rows_seen = EXCLUDED.rows_seen,
           ok = EXCLUDED.ok, note = EXCLUDED.note`,
        [
          l.source,
          l.crawledAt,
          l.calls.length,
          l.rejected.length ? `${l.rejected.length} row(s) rejected` : null,
        ],
      );

    // The /data/updates feed (feedback_pg_changelog_required). The key must survive a reload,
    // so it is the natural (source, source_key) pair rather than the serial id.
    const batch = await recordIngestBatch(c, {
      source: "open_call",
      table: "open_calls",
      keyExpr: "t.source || ':' || t.source_key",
      nameExpr: "t.title",
      detailExpr: "coalesce(t.code, t.programme_name)",
      amountExpr: "t.budget_eur::double precision",
      // THE CORPUS SIZE, not the build size. Every sibling loader passes the build size and is
      // right to, because their tables are full rebuilds. This is the one loader where the two
      // differ — by construction, since it never deletes — and 007's recent_updates renders
      // rows_total verbatim as „N нови · M общо" on /data/updates. Measured: a run whose
      // snapshot was 2 calls short recorded rows_total=64 against a 66-row table.
      rowsTotal: Number(
        (await c.query<{ n: string }>(`SELECT count(*) n FROM ${SPEC.table}`))
          .rows[0]?.n ?? 0,
      ),
    });
    console.log(
      `changelog: batch ${batch.batchId}, ${batch.rowsNew} new (${batch.mode})`,
    );
  });

  const after = Number(
    (await allRows<{ n: string }>("SELECT count(*) n FROM open_calls"))[0]?.n ??
      0,
  );
  // The table is append-and-update only, so it must never shrink. If it did, something grew a
  // DELETE — fail loudly rather than let the archive erode one release at a time.
  if (after < before)
    throw new Error(
      `open_calls shrank ${before} → ${after}: this loader must never delete (see the header)`,
    );
  console.log(`open_calls: ${before} → ${after} row(s); loaded ${all.length}`);
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  loadOpenCalls()
    .then(() => end())
    .catch(async (e) => {
      console.error(e);
      process.exitCode = 1;
      await end();
    });
}
