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
// ── THE DDL HAS A SECOND APPLIER, AND IT IS THE ONE IN THE CHAIN ──────────
//
// This file is NOT the only applier of 152/153, and has not been since T2/T3.
// `load_budget_muni_pg.ts` (`db:load:budget-muni:pg`, IN `db:refresh`) applies
// 152 → 153 → 154 → 157 → 155 in that order, because 155's `LANGUAGE sql`
// bodies are validated at CREATE time and would 42P01 against any of the four.
//
// So a fresh clone DOES get the budget tables — created by the chain, and EMPTY.
// Empty in FULL, not just in the gitignored grain: this excluded loader is the
// only thing that fills either half, so the committed КФП series is absent there
// too. That is the 147_tender_search_text shape.
//
// `budget_pg_roundtrip.data.test.ts` has TWO guards for that and they are not
// interchangeable: `stateSkip` (a row count) is the „applied is not loaded" one
// and is what a chain run hits, while the `pg_class` probe covers the narrower
// case of a hand-built or partial database with no tables at all — its own
// docstring says it exists so the first SELECT does not 42P01.
//
// This file also applies 157, which the chain applier does too.
//
// (The header above said the opposite until 2026-08-15 — „NOT YET TRUE" and
// „THIS FILE IS THE ONLY APPLIER" were written when T4 was still ahead, and
// outlived it. A reader acting on them would conclude a fresh clone has no
// budget tables at all.)
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
const SCHEMA_PROC = resolve(
  __dirname,
  "schema/pg/157_budget_admin_procurement.sql",
);

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
  // ⚠️ THIS IS WHERE `budget_admin_node.eik` COMES FROM, and migration 157's
  // whole procurement footprint joins `contracts` on that column — so this
  // committed artifact is a load-bearing INPUT even though T7 retired it as a
  // browser fetch. It is written offline by `crossReferenceProcurement` during
  // `npm run budget:ingest`, which NAME-MATCHES each budget unit against the
  // awarders index. Postgres COULD express that match — `contracts.awarder_name`
  // is populated on 409,200 rows — but nothing does, so the artifact is the only
  // producer. A procurement ingest that moves the awarder set therefore stales
  // this map, and 157 then attributes contracts to the wrong unit with every row
  // count reconciling. See 157's header for the full trigger list, and
  // `assertProcurementArtifactUsable` for the empty-artifact case.
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

/**
 * Refuse to load an EMPTY procurement artifact over a populated `eik` column.
 *
 * ⚠️ NEITHER EXISTING GUARD SEES THIS. `crossReferenceProcurement`'s own input,
 * `data/procurement/awarders/`, is GITIGNORED — 0 tracked against 4,415 files on
 * a machine that has run the pipeline — so on a fresh clone `npm run
 * budget:ingest` finds no awarders, matches nothing and writes `entries: []`
 * unguarded. The next load then stamps NULL over all 46 EIKs and migration 157
 * rebuilds to ZERO rows, while `merge()`'s shrink floor and `mergeFromStage`'s
 * parity check both pass: they compare NODE counts (54, unchanged), not EIKs.
 * That is the class `merge()`'s own docblock warns about, one level down at the
 * column.
 *
 * Refusing is right rather than defensive — the artifact is COMMITTED, so an
 * empty one beside a populated table means the ingest ran without its input, not
 * that the state genuinely has no procurement match. A FIRST load has nothing to
 * protect, so the guard asks the table rather than assuming.
 */
const assertProcurementArtifactUsable = async (): Promise<void> => {
  const proc = readJson<MinistryProcurementFile>(
    "budget/derived/ministry_procurement.json",
  );
  const matched = (proc?.entries ?? []).filter((e) => e.eik).length;
  if (matched > 0) return;
  const prior = await allRows<{ n: string }>(
    "SELECT count(*)::text n FROM budget_admin_node WHERE eik IS NOT NULL",
  ).catch(() => [{ n: "0" }]);
  const had = Number(prior[0]?.n ?? 0);
  if (had === 0) return;
  throw new Error(
    `ministry_procurement.json matched no spending unit, but ${had} already ` +
      "carry an EIK. Loading it would blank the procurement cross-link " +
      "(migration 157) with every row count reconciling. That is what " +
      "`npm run budget:ingest` writes when data/procurement/awarders/ is " +
      "absent — it is gitignored, so a fresh clone has none. Restore the " +
      "awarders index and re-run the ingest, or `git checkout` the artifact.",
  );
};

const loadPersonnel = (): unknown[][] => {
  const p = readRequired<PersonnelFile>("budget/personnel.json");

  // ── the NATIONAL grain: the annual Доклад ────────────────────────────────
  const national = Object.entries(p.national).map(([year, d]) => {
    // NSI publishes nothing before 2021, and the shard renders that as an EMPTY
    // breakdown summed to 0 — four of the nine years on file. A stored 0 is a
    // claim ("98k in 2021, none in 2020"); NULL is the truth. This is the
    // plan's §2.2 withheld-≠-zero trap, and the sibling columns already draw
    // the distinction correctly (positions_filled is NULL for 2017).
    const nsi = d.nsiHeadcount;
    const nsiPublished =
      Object.keys(nsi?.central ?? {}).length > 0 ||
      Object.keys(nsi?.territorial ?? {}).length > 0;
    const pos = d.positions;
    // The Доклад publishes structure counts as a MAP of body-kind → count, and
    // the page shows their sums (114 + 467 = 581 in FY2025). Summed here rather
    // than in SQL because a missing map must stay NULL: `sum({})` is 0, and „0
    // administrative structures" is a claim about a state with none.
    const sumCounts = (
      m: Record<string, number> | undefined,
    ): number | null => {
      const vals = Object.values(m ?? {});
      return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
    };
    return [
      Number(year),
      null, // the national row
      pos?.total ?? null,
      pos?.filled ?? null,
      pos?.vacant ?? null,
      nsiPublished ? (nsi?.total ?? null) : null,
      null, // payroll_eur — the Доклад publishes none at this grain
      pos?.central ?? null,
      pos?.territorial ?? null,
      pos?.municipal ?? null,
      pos?.municipalOwnRevenue ?? null,
      pos?.vacantOverSixMonths ?? null,
      sumCounts(d.structureCounts?.central),
      sumCounts(d.structureCounts?.territorial),
      null, // headcount_executed — unit grain only
      null, // avg_cost_per_fte_eur — unit grain only
    ];
  });

  // ── the UNIT grain: each ministry's own programme-budget report ───────────
  //
  // A DIFFERENT PUBLISHER from the Доклад above, which is why these land on
  // their own rows rather than widening the national ones: the Доклад counts
  // щатни бройки across the whole administration, a programme-budget report
  // counts executed FTE inside one ministry. Summing the units does not give
  // the national figure and is not meant to.
  //
  // `adminId` is `budget_admin_node.node_id` — verified against all nine — so
  // names are joined at serve time rather than duplicated here.
  const units = Object.values(p.byMinistry).flatMap((list) =>
    list.map((m) => [
      m.fiscalYear,
      m.adminId,
      null, // positions_* are the Доклад's grain, not this one
      null,
      null,
      null,
      m.totalPersonnel?.executed?.amountEur ?? null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      m.totalHeadcount?.executed ?? null,
      m.avgAnnualCostPerFte?.amountEur ?? null,
    ]),
  );

  return [...national, ...units];
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
  // BEFORE any DDL or COPY: this refuses rather than degrades, so it must fire
  // while the corpus is still the previous good one.
  await assertProcurementArtifactUsable();

  await exec(readFileSync(SCHEMA_KFP, "utf8"));
  await exec(readFileSync(SCHEMA_ADMIN, "utf8"));
  // 157 AFTER 153: the cross-link table keys on budget_admin_node. It creates
  // empty and its rebuild is a guarded no-op where `contracts` is absent, so it
  // applies on a database that has never seen the procurement corpus.
  await exec(readFileSync(SCHEMA_PROC, "utf8"));

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

  // Personnel is a plain replace: ~9 national rows plus ~14 unit rows, and the
  // annual Доклад can retract a year, which a merge would silently keep.
  //
  // ⚠️ THE DELETE IS UNSCOPED NOW. It used to be `WHERE node_id IS NULL`, which
  // was right while the loader only wrote national rows — but T9.8 added the
  // per-ministry grain, and a delete that skips those would let a ministry
  // dropped from the source live on for ever, rendered beside current ones.
  await withTx(async (c) => {
    await c.query("DELETE FROM budget_personnel");
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
        "positions_central",
        "positions_territorial",
        "positions_municipal",
        "positions_municipal_own_rev",
        "positions_vacant_over_6m",
        "structures_central",
        "structures_territorial",
        "headcount_executed",
        "avg_cost_per_fte_eur",
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

  // The procurement cross-link (157). Rebuilt here because the admin dimension
  // it keys on has just been reloaded — a node that gained or lost its EIK
  // changes its whole footprint. It returns 0 without touching anything when
  // `contracts` is absent, which is the fresh-clone and budget-only case.
  //
  // ⚠️ THE OTHER TRIGGER IS A CONTRACTS RELOAD, and it is not this loader's to
  // fire: `load_pg.ts` calls the same function for that reason. Without it a
  // procurement re-ingest leaves every ministry's footprint on the previous
  // corpus at a 200 — the staleness shape this file's own header warns about.
  const procRows = await allRows<{ n: string }>(
    "SELECT rebuild_budget_admin_procurement()::text AS n",
  );
  const procN = Number(procRows[0]?.n ?? 0);
  console.log(
    procN > 0
      ? `  admin↔procurement: ${procN} row(s)`
      : "  admin↔procurement: skipped (no contracts corpus)",
  );

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
    // TRUNCATE + INSERT in one transaction inside the rebuild, so its map is
    // permanently unmarked without this. Skipped by vacuumAfterReload's own
    // existence check on a database where 157 never applied.
    "budget_admin_procurement",
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
