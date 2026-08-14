// Load the state-budget corpus into Postgres (migrations 152 + 153).
//
//   npm run db:load:budget:pg
//   npm run db:load:budget:pg:cloud
//
// Plan: docs/plans/budget-hub-v1.md T1.
//
// ── WHY THIS IS IN REFRESH_EXCLUSIONS ─────────────────────────────────────
//
// Two of its inputs are GITIGNORED — `data/budget/reconciliation/` and
// `data/budget/ministries/`, bulky regenerable shards shipped to the bucket
// only. Measured: `git ls-files` returns 0 for both, against 24 and 55 files on
// a machine that has run the pipeline. So on a fresh clone and on CI this
// loader has no admin or programme grain to load at all, which is the
// "uncommitted-input" axis in scripts/db/refresh_coverage.ts.
//
// It is NOT excluded on cost: the whole corpus is ~2 MB and the load is
// seconds. Recording the right axis matters — the gaps plan (§1a) documents
// five loaders that were once mis-sorted by cost when the operative constraint
// was the input.
//
// ── THE DDL WILL GET A SECOND APPLIER; TODAY IT HAS ONLY THIS ONE ─────────
//
// ⚠️ NOT YET TRUE — stated here as the intent, not as the state of the tree.
// Because this loader is excluded, `db:load:budget-hub:pg` (T4, which WILL be
// in the chain) must also apply 152 + 153 before its own 155 + 156, or 155's
// `LANGUAGE sql` bodies — validated at CREATE time — 42P01 on a fresh clone and
// roll back. The tables will then EXIST wherever the serving layer does and be
// EMPTY where the shards were never available: the 147_tender_search_text shape.
//
// Until that ships, THIS FILE IS THE ONLY APPLIER, and it is out of the chain —
// so a fresh clone has no budget tables at all. `budget_pg_roundtrip.data.test.ts`
// skips on exactly that state rather than erroring, which is why its skip guard
// probes pg_class and not just the shard tree.
//
// ── SKIP-AND-WARN vs THROW ────────────────────────────────────────────────
//
// Absent and malformed are different states. A missing shard tree is the
// normal fresh-clone condition and must not fail anything; a PRESENT and
// broken file must throw, because treating it as "no data" is how a corpus
// silently empties. The committed inputs (kfp.json, index.json, documents.json,
// personnel.json, cofog.json) get NO absent-tolerant branch: a tracked file
// cannot legitimately vanish, so its absence is a real defect that should be
// loud.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  allRows,
  exec,
  withClient,
  withTx,
  end,
  vacuumAfterReload,
} from "./lib/pg";
import { copyRows } from "./lib/copy";
import {
  addStagePrimaryKey,
  createStageTable,
  mergeFromStage,
  type StageMergeSpec,
} from "./lib/stage_merge";
import { recordIngestBatch } from "./lib/ingest_changelog";
import type {
  BudgetDocumentsFile,
  BudgetIndex,
  KfpFile,
  PersonnelFile,
  ReconciliationRow,
} from "../../src/data/budget/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "../..");
const DATA = resolve(REPO, "data");
const SCHEMA_KFP = resolve(__dirname, "schema/pg/152_budget_kfp.sql");
const SCHEMA_ADMIN = resolve(__dirname, "schema/pg/153_budget_admin.sql");

/** The gitignored trees, REPO-relative — so they read the same way in a warning,
 *  in `.gitignore` and in the plan. Resolve them against REPO, never DATA. */
export const UNCOMMITTED_INPUTS = [
  "data/budget/reconciliation",
  "data/budget/ministries",
] as const;

/** Absent → null (normal for a gitignored path). Present-but-broken → throw,
 *  naming the file: a bare SyntaxError from a reader of eight paths says
 *  nothing about which one. */
const readJson = <T>(rel: string): T | null => {
  const file = resolve(DATA, rel);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (e) {
    throw new Error(
      `${rel} is present but unparseable: ${(e as Error).message}`,
    );
  }
};

/** A committed input. Absent is a defect, not a state. */
const readRequired = <T>(rel: string): T => {
  const parsed = readJson<T>(rel);
  if (parsed === null) {
    throw new Error(
      `${rel} is missing. It is a COMMITTED file, so this is not the fresh-clone ` +
        "case — run `npm run data -- --all` or restore it.",
    );
  }
  return parsed;
};

interface CofogFileShape {
  latestYear: number;
  cofogTopLevel: string[];
  series: Record<string, Array<{ year: number; valueEur: number }>>;
}

interface MinistryProcurementFile {
  entries: Array<{ nodeId: string; eik: string | null }>;
}

/** Only the fields the programme→owner map needs. The full shape lives in
 *  src/data/budget/types; a narrow local view keeps this reader honest about
 *  what it actually depends on. */
interface MinistryShardFile {
  years?: Array<{ programs?: Array<{ nodeId?: string }> }>;
}

// ── Stage-merge specs ──────────────────────────────────────────────────────
//
// STAGE MERGE, not TRUNCATE + rebuild. Every one of these lands on a serving
// path once T3 ships, and a plain TRUNCATE takes an AccessExclusiveLock that
// 55P03s live readers for the length of the load. `contracts` is the worked
// precedent (reference_stage_merge_reload).

const FISCAL_YEAR: StageMergeSpec = {
  table: "budget_fiscal_year",
  source: "budget_fiscal_year_stage",
  keys: ["fiscal_year"],
  cols: [
    "fiscal_year",
    "as_of",
    "complete",
    "months_available",
    "first_period",
    "last_period",
    "gdp_eur",
    "source_denomination",
    "projection_basis",
    "population",
    "population_basis",
  ],
};

const FY_FIGURE: StageMergeSpec = {
  table: "budget_fiscal_year_figure",
  source: "budget_fiscal_year_figure_stage",
  keys: ["fiscal_year", "series", "basis"],
  cols: ["fiscal_year", "series", "basis", "amount_eur"],
};

const KFP_OBS: StageMergeSpec = {
  table: "budget_kfp_observation",
  source: "budget_kfp_observation_stage",
  keys: ["fiscal_year", "period", "series", "constituent_budget"],
  cols: [
    "fiscal_year",
    "period",
    "series",
    "constituent_budget",
    "as_of",
    "cadence",
    "executed_eur",
    "planned_eur",
    "source_ref",
  ],
};

const KFP_SECTION: StageMergeSpec = {
  table: "budget_kfp_snapshot_section",
  source: "budget_kfp_snapshot_section_stage",
  keys: ["fiscal_year", "period", "section_code"],
  cols: [
    "fiscal_year",
    "period",
    "section_code",
    "kind",
    "series",
    "label_bg",
    "label_en",
    "executed_eur",
    "planned_eur",
  ],
};

const KFP_LINE: StageMergeSpec = {
  table: "budget_kfp_snapshot_line",
  source: "budget_kfp_snapshot_line_stage",
  keys: ["fiscal_year", "period", "section_code", "line_ord"],
  cols: [
    "fiscal_year",
    "period",
    "section_code",
    "line_ord",
    "kind",
    "depth",
    "is_subtotal",
    "label_bg",
    "label_en",
    "group_label_bg",
    "group_label_en",
    "executed_eur",
    "planned_eur",
  ],
};

const ADMIN_NODE: StageMergeSpec = {
  table: "budget_admin_node",
  source: "budget_admin_node_stage",
  keys: ["node_id"],
  cols: ["node_id", "name_bg", "name_en", "eik"],
};

const ADMIN_FACT: StageMergeSpec = {
  table: "budget_admin_fact",
  source: "budget_admin_fact_stage",
  keys: ["fiscal_year", "node_id", "kind", "dimension"],
  cols: [
    "fiscal_year",
    "node_id",
    "kind",
    "dimension",
    "planned_eur",
    "planned_law_eur",
    "amended_eur",
    "executed_eur",
    "variance_eur",
    "variance_pct",
    "completeness",
    "amendment_trail",
  ],
};

const PROGRAM_FACT: StageMergeSpec = {
  table: "budget_program_fact",
  source: "budget_program_fact_stage",
  keys: ["fiscal_year", "program_code"],
  cols: [
    "fiscal_year",
    "program_code",
    "node_id",
    "name_bg",
    "name_en",
    "planned_eur",
    "amended_eur",
    "executed_eur",
    "completeness",
  ],
};

const COFOG: StageMergeSpec = {
  table: "budget_cofog",
  source: "budget_cofog_stage",
  keys: ["fiscal_year", "cofog_code"],
  cols: [
    "fiscal_year",
    "cofog_code",
    "name_bg",
    "name_en",
    "amount_eur",
    "pct_of_total",
  ],
};

const DOCUMENT: StageMergeSpec = {
  table: "budget_document",
  source: "budget_document_stage",
  keys: ["document_id"],
  cols: [
    "document_id",
    "fiscal_year",
    "kind",
    "title_bg",
    "title_en",
    "published_on",
    "dv_issue",
    "url",
    "obs_category",
    "adopted_by_item_id",
  ],
};

// ── The OGP / IBP eight key budget documents ───────────────────────────────
//
// The mapping is a CONSTANT, not a heuristic: each BudgetDocKind maps to at
// most one of the eight, and a kind that maps to none carries NULL rather than
// being forced into the nearest slot. /budget/law scores the frame from this,
// so a wrong entry there becomes a claim about what Bulgaria publishes.
//
// FOUR slots have no kind mapping to them: pre-budget-statement,
// executive-budget-proposal, citizens-budget and mid-year-review. That is a
// statement about WHAT THIS REPO INGESTS, never about what Bulgaria publishes —
// an earlier version of this comment claimed Bulgaria issues no citizens budget
// and that is false (IBP's Open Budget Survey records one in 2019, 2021 and
// 2023, scored 67/100 in the last round). /budget/law therefore frames its
// score as coverage here and makes no country-level claim.
const OBS_CATEGORY: Record<string, string | null> = {
  law: "enacted-budget",
  "interim-law": "enacted-budget",
  "fund-law": "enacted-budget",
  amendment: "enacted-budget",
  "execution-report": "year-end-report",
  "audit-report": "audit-report",
  "kfp-feed": "in-year-report",
};

const num = (v: { amountEur?: number | null } | null | undefined) =>
  v?.amountEur ?? null;

const loadKfp = (
  index: BudgetIndex,
): {
  years: unknown[][];
  figures: unknown[][];
  obs: unknown[][];
  sections: unknown[][];
  lines: unknown[][];
} => {
  const kfp = readRequired<KfpFile>("budget/kfp.json");

  const years = index.fiscalYears.map((f) => [
    f.fiscalYear,
    f.asOf,
    f.complete,
    f.monthsAvailable,
    f.firstPeriod,
    f.lastPeriod,
    f.gdpEur,
    f.currency,
    f.projectionBasis,
    // Left NULL here on purpose. The national per-capita denominator is a
    // SEPARATE decision with three defensible answers (ГРАО permanent, ГРАО
    // current, Census 2021) and no consumer yet; writing one now would ship a
    // denominator nothing named. plan §7.1.
    null,
    null,
  ]);

  const figures: unknown[][] = [];
  for (const f of index.fiscalYears) {
    for (const [basis, figs] of [
      ["actual", f.actual],
      ["planned", f.planned],
      ["projected", f.projected],
    ] as const) {
      if (!figs) continue;
      for (const series of [
        "revenue",
        "expenditure",
        "euContribution",
        "balance",
        "financing",
      ] as const) {
        const v = num(figs[series]);
        if (v == null) continue;
        figures.push([f.fiscalYear, series, basis, v]);
      }
    }
  }

  const obs = kfp.observations.map((o) => [
    o.fiscalYear,
    o.period,
    o.series,
    o.constituentBudget,
    o.asOf,
    o.cadence,
    num(o.executed),
    num(o.planned),
    o.sourceRef ? JSON.stringify(o.sourceRef) : null,
  ]);

  const lines: unknown[][] = [];
  const sections: unknown[][] = [];
  for (const snap of kfp.snapshots) {
    for (const section of snap.sections) {
      // The section frame is captured SEPARATELY, not folded onto the lines.
      // `series` is what distinguishes sections II and III — both carry
      // kind = 'expenditure', and III is the EU contribution — and sections III
      // and IV publish a total with ZERO lines, so a line-only capture makes
      // the EU contribution and the deficit vanish from the snapshot entirely.
      sections.push([
        snap.fiscalYear,
        snap.period,
        section.code,
        section.kind,
        section.series,
        section.labelBg,
        section.labelEn,
        num(section.executed),
        num(section.planned),
      ]);
      // `line_ord` must preserve the SOURCE order: the shard publishes no
      // parent key, so the tree is rebuilt downstream from (depth, line_ord).
      section.lines.forEach((l, i) => {
        lines.push([
          snap.fiscalYear,
          snap.period,
          section.code,
          i,
          section.kind,
          l.depth,
          l.isSubtotal,
          l.labelBg,
          l.labelEn,
          l.groupLabelBg,
          l.groupLabelEn,
          num(l.executed),
          num(l.planned),
        ]);
      });
    }
  }

  return { years, figures, obs, sections, lines };
};

/** The admin + programme grain. Returns null when the gitignored tree is
 *  absent — the caller then leaves those tables untouched rather than emptying
 *  them, because "I cannot see the shards" must never delete a corpus a
 *  previous run loaded. */
const loadAdmin = (
  years: number[],
): {
  nodes: unknown[][];
  facts: unknown[][];
  programs: unknown[][];
} | null => {
  const dir = resolve(REPO, UNCOMMITTED_INPUTS[0]);
  // ABSENT is the fresh-clone state: skip, leave the tables untouched.
  if (!existsSync(dir)) return null;
  // PRESENT-BUT-EMPTY is a broken tree, and it is NOT the same thing. Loading on
  // from here would stage zero rows and let the anti-join delete the corpus —
  // `merge()`'s shrink guard would catch it, but failing here says why.
  const yearDirs = readdirSync(dir).filter((d) => /^\d{4}$/.test(d));
  if (yearDirs.length === 0) {
    throw new Error(
      `${UNCOMMITTED_INPUTS[0]}/ exists but holds no year directories. That is a broken ` +
        "tree, not the fresh-clone case — loading on would empty the admin and programme " +
        "grain. Run `npm run data -- --all` to regenerate it.",
    );
  }

  const eikByNode = new Map<string, string | null>();
  const proc = readJson<MinistryProcurementFile>(
    "budget/derived/ministry_procurement.json",
  );
  for (const e of proc?.entries ?? []) eikByNode.set(e.nodeId, e.eik ?? null);

  // The programme → owning-unit map. `by-program.json` keys rows on a PROGRAMME
  // slug and names no owner; the per-ministry shards carry the edge. Measured:
  // 124 programme ids, 727/727 rows resolved, and ZERO owned by more than one
  // admin node — within a year or across all nine.
  //
  // data/budget/ministries/ is the second gitignored tree, so this map can be
  // empty on a machine that has `reconciliation/` and not `ministries/`. That
  // yields NULL owners rather than a failure: the programme rows are still
  // worth loading, and NULL says "unknown here", which is true.
  const ownerByProgram = new Map<string, string>();
  const ministriesDir = resolve(REPO, UNCOMMITTED_INPUTS[1]);
  if (existsSync(ministriesDir)) {
    for (const file of readdirSync(ministriesDir).filter((f) =>
      f.endsWith(".json"),
    )) {
      const adminNode = file.replace(/\.json$/, "");
      const m = readJson<MinistryShardFile>(`budget/ministries/${file}`);
      for (const y of m?.years ?? []) {
        for (const p of y.programs ?? []) {
          if (p.nodeId) ownerByProgram.set(p.nodeId, adminNode);
        }
      }
    }
  }

  const nodes = new Map<string, unknown[]>();
  const facts: unknown[][] = [];
  const programs: unknown[][] = [];

  for (const fy of years) {
    const admin = readJson<ReconciliationRow[]>(
      `budget/reconciliation/${fy}/by-admin.json`,
    );
    for (const r of admin ?? []) {
      if (!nodes.has(r.nodeId)) {
        nodes.set(r.nodeId, [
          r.nodeId,
          r.nodeNameBg,
          r.nodeNameEn,
          eikByNode.get(r.nodeId) ?? null,
        ]);
      }
      facts.push([
        r.fiscalYear,
        r.nodeId,
        r.kind,
        r.dimension,
        num(r.planned),
        num(r.plannedLaw),
        num(r.amended),
        num(r.executed),
        r.varianceEur,
        r.variancePct,
        r.completeness,
        r.amendmentTrail ? JSON.stringify(r.amendmentTrail) : null,
      ]);
    }

    const prog = readJson<ReconciliationRow[]>(
      `budget/reconciliation/${fy}/by-program.json`,
    );
    for (const r of prog ?? []) {
      programs.push([
        r.fiscalYear,
        // `r.nodeId` here is the PROGRAMME (a `prog-…` slug), not a spending
        // unit — 0 of 86 FY2024 values appear in budget_admin_node. It is the
        // programme's identity, so it lands in program_code…
        r.nodeId,
        // …and the owner is recovered from the ministries tree. NULL when that
        // tree is absent, which is a knowable state rather than a wrong link.
        ownerByProgram.get(r.nodeId) ?? null,
        r.nodeNameBg,
        r.nodeNameEn,
        num(r.planned),
        num(r.amended),
        num(r.executed),
        r.completeness,
      ]);
    }
  }

  return { nodes: [...nodes.values()], facts, programs };
};

const loadPersonnel = (): unknown[][] => {
  const p = readRequired<PersonnelFile>("budget/personnel.json");
  return Object.entries(p.national).map(([year, d]) => {
    // NSI publishes nothing before 2021, and the shard renders that as an EMPTY
    // breakdown summed to 0 — four of the nine years on file. A stored 0 is a
    // claim ("98k in 2021, none in 2020"); NULL is the truth. This is the
    // plan's §2.2 withheld-≠-zero trap, and the sibling columns already draw
    // the distinction correctly (positions_filled is NULL for 2017).
    const nsi = d.nsiHeadcount;
    const nsiPublished =
      Object.keys(nsi?.central ?? {}).length > 0 ||
      Object.keys(nsi?.territorial ?? {}).length > 0;
    return [
      Number(year),
      null, // the national row
      d.positions?.total ?? null,
      d.positions?.filled ?? null,
      d.positions?.vacant ?? null,
      nsiPublished ? (nsi?.total ?? null) : null,
      null,
    ];
  });
};

const loadCofog = (): unknown[][] => {
  const c = readRequired<CofogFileShape>("cofog.json");
  const rows: unknown[][] = [];
  const totalByYear = new Map<number, number>();
  for (const p of c.series["TOTAL"] ?? []) totalByYear.set(p.year, p.valueEur);
  for (const code of c.cofogTopLevel) {
    for (const p of c.series[code] ?? []) {
      const total = totalByYear.get(p.year);
      rows.push([
        p.year,
        code,
        null,
        null,
        p.valueEur,
        // Share of the S13 TOTAL, which is what the COFOG corpus's own
        // denominator is — NOT of the КФП state-budget expenditure, a
        // different aggregate entirely (153's header).
        code === "TOTAL" || !total ? null : (p.valueEur / total) * 100,
      ]);
    }
  }
  return rows;
};

const loadDocuments = (): unknown[][] => {
  const d = readRequired<BudgetDocumentsFile>("budget/documents.json");
  return d.documents.map((doc) => [
    doc.id,
    doc.fiscalYear,
    doc.kind,
    doc.title,
    null,
    doc.promulgationDate ?? doc.reportDate ?? null,
    null,
    doc.sources?.[0]?.url ?? null,
    OBS_CATEGORY[doc.kind] ?? null,
    // Never inferred from the title. T6.6 resolves these against vote_item.
    null,
  ]);
};

/** `--allow-shrink` — the escape hatch for a retraction that is genuinely real. */
const ALLOW_SHRINK = process.argv.includes("--allow-shrink");
/** A build below this share of the live table is treated as a broken input. */
const SHRINK_FLOOR = 0.95;

/**
 * Stage-merge one table, REFUSING a build that would shrink it materially.
 *
 * The refusal is the point. `mergeFromStage`'s delete is an UNSCOPED anti-join,
 * and its parity guard compares `count(live)` to `count(staged)` AFTER that
 * delete — so an empty stage deletes every row and then passes 0 == 0. Measured
 * inside a rolled-back transaction on the real corpus: an empty admin stage
 * removes 55 nodes, 873 facts (silently, via ON DELETE CASCADE, so they are not
 * even in the DELETE's own count) and 727 programme rows, and the loader exits
 * 0 printing "0 admin fact(s)" — indistinguishable from a first run.
 *
 * Reachable without anything exotic: a `reconciliation/` directory that exists
 * but is empty, a subset of years, a missing `by-program.json`, or a committed
 * input regenerated with `observations: []` (valid JSON, so `readRequired`
 * passes it straight through).
 *
 * This is the class CLAUDE.md already names for Interreg — "a partial stage
 * deletes every other programme's operations … and the parity guard passes
 * again" — and the repo's established answer is to refuse: kzk_decisions
 * refuses a >5% shrink, the Interreg loader refuses an empty crosswalk.
 */
const merge = async (
  spec: StageMergeSpec,
  rows: unknown[][],
): Promise<void> => {
  const [live] = await allRows<{ n: string }>(
    `SELECT count(*)::text n FROM ${spec.table}`,
  );
  const liveRows = Number(live?.n ?? 0);
  if (!ALLOW_SHRINK && liveRows > 0 && rows.length < liveRows * SHRINK_FLOOR) {
    throw new Error(
      `${spec.table}: the build produced ${rows.length} row(s) against ${liveRows} live — ` +
        "refusing. mergeFromStage's anti-join would DELETE the difference and its parity " +
        "guard would still pass, because it compares counts AFTER the delete. Check the " +
        "shard tree; pass --allow-shrink if the retraction is real.",
    );
  }
  try {
    await withClient(async (c) => {
      await createStageTable(c, spec);
      await copyRows(c, spec.source, spec.cols, rows);
      await addStagePrimaryKey(c, spec);
    });
    await withTx(async (c) => {
      await mergeFromStage(c, spec);
    });
  } finally {
    // In `finally`: a mid-run failure must not leave an UNLOGGED stage table
    // behind for the next run's createStageTable to collide with.
    await exec(`DROP TABLE IF EXISTS ${spec.source}`);
  }
};

export const loadBudgetPg = async (): Promise<{
  years: number;
  observations: number;
  lines: number;
  adminFacts: number | null;
  documents: number;
}> => {
  await exec(readFileSync(SCHEMA_KFP, "utf8"));
  await exec(readFileSync(SCHEMA_ADMIN, "utf8"));

  // Parsed ONCE and threaded through: the first cut read index.json twice per
  // run, and two reads of one file are two chances to disagree.
  const index = readRequired<BudgetIndex>("budget/index.json");
  const { years, figures, obs, sections, lines } = loadKfp(index);
  // Parent before child: budget_fiscal_year_figure has an FK onto
  // budget_fiscal_year, so the figures cannot land first.
  await merge(FISCAL_YEAR, years);
  await merge(FY_FIGURE, figures);
  await merge(KFP_OBS, obs);
  await merge(KFP_SECTION, sections);
  await merge(KFP_LINE, lines);

  // The UNION, not the KFP summary set. `index.fiscalYears` is KFP-derived and
  // starts at 2021; the reconciliation shards cover 2018-2026, so enumerating
  // the summary set alone silently drops three years of the admin grain — 551
  // facts instead of the full corpus, with nothing failing. `index.years` is the
  // coverage array and reaches back; neither is a superset of the other.
  //
  // budget_admin_fact has no FK onto budget_fiscal_year, so a pre-2021 admin
  // year with no KFP summary is a legitimate row rather than an orphan.
  const fiscalYears = [
    ...new Set([
      ...years.map((y) => Number(y[0])),
      ...index.years.map((y) => y.fiscalYear),
    ]),
  ].sort((a, b) => a - b);
  const admin = loadAdmin(fiscalYears);
  if (admin) {
    // Nodes before facts — the FK again.
    await merge(ADMIN_NODE, admin.nodes);
    await merge(ADMIN_FACT, admin.facts);
    await merge(PROGRAM_FACT, admin.programs);
  } else {
    console.warn(
      `[budget] ${UNCOMMITTED_INPUTS[0]}/ absent — the admin and programme grain ` +
        "is GITIGNORED (bucket-shipped only), so this machine has none. The tables " +
        "are left as they are rather than emptied. Run `npm run data -- --all` to " +
        "regenerate the shards.",
    );
  }

  await merge(COFOG, loadCofog());
  const docs = loadDocuments();
  await merge(DOCUMENT, docs);

  // Personnel is a plain replace: ~9 national rows, no serving path yet, and the
  // annual Доклад can retract a year, which a merge would silently keep.
  await withTx(async (c) => {
    await c.query("DELETE FROM budget_personnel WHERE node_id IS NULL");
    await copyRows(
      c,
      "budget_personnel",
      [
        "fiscal_year",
        "node_id",
        "positions_total",
        "positions_filled",
        "positions_vacant",
        "nsi_headcount",
        "payroll_eur",
      ],
      loadPersonnel(),
    );
    // Keyed on (year, PERIOD, series), not on the fiscal year.
    //
    // The КФП feed refreshes MONTHLY and the fiscal years do not change, so a
    // year-keyed changelog sees the same six keys for ever: every refresh after
    // the first reports rows_new = 0 and a budget update can never appear in
    // /data/updates. The observation grain is what actually moves — a new month
    // is a new key — which is the whole point of the feed.
    await recordIngestBatch(c, {
      source: "budget",
      table: "budget_kfp_observation",
      keyExpr: "t.fiscal_year || '/' || t.period || '/' || t.series",
      nameExpr: "'Държавен бюджет ' || t.fiscal_year",
      detailExpr: "'КФП ' || t.period || ' — ' || t.series",
      amountExpr: "t.executed_eur::double precision",
      rowsTotal: obs.length,
    });
  });

  // Outside the transaction — VACUUM cannot run in one. The stage merges keep
  // their visibility maps, but budget_personnel is DELETE + COPY, which is the
  // shape that leaves relallvisible = 0 for ever.
  await vacuumAfterReload(
    "budget_fiscal_year",
    "budget_fiscal_year_figure",
    "budget_kfp_observation",
    "budget_kfp_snapshot_section",
    "budget_kfp_snapshot_line",
    "budget_personnel",
  );

  return {
    years: years.length,
    observations: obs.length,
    lines: lines.length,
    adminFacts: admin ? admin.facts.length : null,
    documents: docs.length,
  };
};

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  loadBudgetPg()
    .then((r) => {
      console.log(
        `[budget] ${r.years} fiscal year(s), ${r.observations} КФП observation(s), ` +
          `${r.lines} snapshot line(s), ` +
          `${r.adminFacts == null ? "admin grain SKIPPED (gitignored)" : `${r.adminFacts} admin fact(s)`}, ` +
          `${r.documents} document(s)`,
      );
      return end();
    })
    .catch(async (e) => {
      console.error(e);
      await end();
      process.exit(1);
    });
}
