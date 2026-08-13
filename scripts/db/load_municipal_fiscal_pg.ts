// Load data/budget/municipal_fiscal/*.json into `municipal_fiscal` (149).
//
//   npm run db:load:municipal-fiscal:pg
//   npm run db:load:municipal-fiscal:pg:cloud
//
// Pure LOAD: the input is the COMMITTED per-quarter JSON, so this works on a
// fresh clone with no workbook drops and no network. The fetch half is
// scripts/budget/municipal_fiscal/ingest.ts, which needs the gitignored
// workbooks and is an operator action.
//
// STAGE MERGE, not TRUNCATE + rebuild: `municipal_fiscal` is on a serving path
// (the governance tile, the national browse), and a plain TRUNCATE takes an
// AccessExclusiveLock that 55P03s live readers for the length of the load.
//
// SKIP-AND-WARN when the corpus is absent, THROW when it is malformed. The two
// are different states: a fresh clone that has never run the ingest should not
// fail a 57-step db:refresh, but a present-and-broken file must not be quietly
// treated as "no data" — that is how a corpus silently empties.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { exec, withClient, withTx, end, vacuumAfterReload } from "./lib/pg";
import { copyRows } from "./lib/copy";
import {
  addStagePrimaryKey,
  createStageTable,
  mergeFromStage,
  type StageMergeSpec,
} from "./lib/stage_merge";
import { recordIngestBatch } from "./lib/ingest_changelog";
import type { MunicipalFiscalQuarter } from "../budget/municipal_fiscal/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../../data/budget/municipal_fiscal");
const SCHEMA = resolve(__dirname, "schema/pg/149_municipal_fiscal.sql");

const SPEC: StageMergeSpec = {
  table: "municipal_fiscal",
  source: "municipal_fiscal_stage",
  keys: ["obshtina", "fiscal_year", "quarter"],
  cols: [
    "obshtina",
    "mf_code",
    "fiscal_year",
    "quarter",
    "commitments_eur",
    "expense_obligations_eur",
    "arrears_eur",
    "revenue_eur",
    "expenditure_eur",
    "budget_balance_eur",
    "cash_on_hand_eur",
    "debt_stock_eur",
    "expenditure_avg4y_eur",
    "own_revenue_avg3y_eur",
    "currency",
    "arrears_pct",
    "obligations_pct",
    "commitments_pct",
    "arrears_basis",
    "obligations_basis",
    "commitments_basis",
    "ind_revenue_share_pct",
    "ind_local_coverage_pct",
    "ind_balance_share_pct",
    "ind_debt_to_own_revenue_pct",
    "ind_debt_per_capita",
    "ind_arrears_to_own_rev_pct",
    "ind_population_per_employee",
    "ind_wage_share_pct",
    "ind_capital_share_pct",
    "collection_dni_pct",
    "collection_dprs_pct",
    "collection_avg_pct",
    "criteria_met",
    "criteria_evaluable",
    "meets_threshold",
    "in_recovery_procedure",
    "suppressed_fields",
    "name_bg",
    "source_file",
  ],
};

interface QuarterFile {
  period: string;
  municipalityCount: number;
  rows: MunicipalFiscalQuarter[];
}

/** Postgres array literal, or null. `smallint[]` and `text[]` both accept it. */
const pgArray = (v: readonly (string | number)[] | null | undefined) =>
  v == null ? null : `{${v.join(",")}}`;

/** Which чл. 130а criteria this row could evaluate AT ALL from this source, and
 *  which of those are met.
 *
 *  Only three of the six are computable from the workbook, and saying so is the
 *  point of the pair. т. 1 needs debt SERVICE (плащания) — the workbook
 *  publishes only the debt STOCK, so it is not derivable here. т. 5 needs three
 *  consecutive years of budget balance. т. 6 needs the national collection mean.
 *  Reporting "2 met" without reporting "of 3 checked" invites the reader to
 *  apply the ≥3 rule to a partial count. */
export const CRITERIA_TOTAL = 6;

export const evaluateCriteria = (
  r: MunicipalFiscalQuarter,
): {
  met: number[] | null;
  evaluable: number[] | null;
  meetsThreshold: boolean | null;
} => {
  if (r.quarter !== 4)
    return { met: null, evaluable: null, meetsThreshold: null };

  const withheld = new Set(suppressedOf(r) ?? []);
  const evaluable: number[] = [];
  const met: number[] = [];
  // A ratio can OUTLIVE its own numerator: on a frozen quarter the ingest nulls
  // the level while the published percentage survives (measured — 265/265 rows
  // on the frozen quarter have `commitments` nulled and `commitmentsPct` set).
  // Minting a criterion from that would be a verdict about a figure we withheld
  // as unattributable. Inert while the frozen quarter is Q3, but МФ's rolling
  // window means Q4 can be the frozen one — and Q4 is the ONLY quarter with
  // verdicts.
  const consider = (
    n: number,
    pct: number | null,
    numerator: (typeof LEVEL_KEYS)[number],
    threshold: number,
  ) => {
    if (pct == null || withheld.has(numerator)) return;
    evaluable.push(n);
    if (pct > threshold) met.push(n);
  };
  // т. 2 — задължения за разходи > 15% of the 4-year average
  consider(2, r.ratios.obligationsPct, "expenseObligations", 15);
  // т. 3 — поети ангажименти > 50% of the 4-year average
  consider(3, r.ratios.commitmentsPct, "commitments", 50);
  // т. 4 — просрочени задължения > 5% of the year's reported expenditure
  consider(4, r.ratios.arrearsPct, "arrears", 5);

  // The чл. 130а rule is "three or more of six", and the criteria are MONOTONE:
  // an unevaluated one can only ever add to the count. So three met is already
  // decisive TRUE even with three unchecked, and — the other direction — a
  // verdict is only FALSE when every criterion was evaluable and fewer than
  // three were met. Everything between is genuinely unknown.
  const meetsThreshold =
    met.length >= 3 ? true : evaluable.length === CRITERIA_TOTAL ? false : null;
  return { met, evaluable, meetsThreshold };
};

const toRow = (r: MunicipalFiscalQuarter): unknown[] => {
  const { met, evaluable, meetsThreshold } = evaluateCriteria(r);
  const eur = (m: { amountEur: number } | null) => m?.amountEur ?? null;
  return [
    r.obshtina,
    r.mfCode,
    r.fiscalYear,
    r.quarter,
    eur(r.commitments),
    eur(r.expenseObligations),
    eur(r.arrears),
    eur(r.revenue),
    eur(r.expenditure),
    eur(r.budgetBalance),
    eur(r.cashOnHand),
    eur(r.debtStock),
    r.expenditureAvg4yEur,
    null, // own_revenue_avg3y_eur — see the note in evaluateCriteria
    r.commitments?.currency ??
      r.arrears?.currency ??
      r.expenditure?.currency ??
      null,
    r.ratios.arrearsPct,
    r.ratios.obligationsPct,
    r.ratios.commitmentsPct,
    r.ratioBasis.arrears,
    r.ratioBasis.obligations,
    r.ratioBasis.commitments,
    r.indicators.revenueSharePct,
    r.indicators.localCoveragePct,
    r.indicators.balanceSharePct,
    r.indicators.debtToOwnRevenuePct,
    r.indicators.debtPerCapita,
    r.indicators.arrearsToOwnRevenuePct,
    r.indicators.populationPerEmployee,
    r.indicators.wageSharePct,
    r.indicators.capitalSharePct,
    r.collection?.dniPct ?? null,
    r.collection?.dprsPct ?? null,
    r.collection?.avgPct ?? null,
    pgArray(met),
    pgArray(evaluable),
    meetsThreshold,
    r.inRecoveryProcedure,
    pgArray(suppressedOf(r)),
    r.nameBg,
    r.sourceFile,
  ];
};

/** Which level fields the ingest withheld for this row — a field that is null
 *  because the source froze the column, as opposed to null because it was not
 *  published. The JSON carries no explicit marker, so it is reconstructed from
 *  the level fields that are null on a row whose siblings are populated. */
const LEVEL_KEYS = [
  "revenue",
  "expenditure",
  "budgetBalance",
  "cashOnHand",
  "debtStock",
  "arrears",
  "expenseObligations",
  "commitments",
] as const;

export const suppressedOf = (r: MunicipalFiscalQuarter): string[] | null => {
  const present = LEVEL_KEYS.filter((k) => r[k] != null);
  // A row with nothing at all is simply unfiled, not suppressed.
  if (present.length === 0) return null;
  const missing = LEVEL_KEYS.filter((k) => r[k] == null);
  return missing.length > 0 ? [...missing] : null;
};

export const loadMunicipalFiscalPg = async (): Promise<{
  quarters: number;
  rows: number;
}> => {
  // This loader is 149's only applier, so a body fix to the serving functions
  // ships with a reload rather than waiting for one.
  await exec(readFileSync(SCHEMA, "utf8"));

  if (!existsSync(DATA_DIR)) {
    console.warn(
      `[municipal-fiscal] ${DATA_DIR} absent — nothing to load. ` +
        "Run scripts/budget/municipal_fiscal/ingest.ts (needs the gitignored workbooks).",
    );
    return { quarters: 0, rows: 0 };
  }
  const files = readdirSync(DATA_DIR)
    .filter((f) => /^\d{4}-Q[1-4]\.json$/.test(f))
    .sort();
  if (files.length === 0) {
    console.warn(
      `[municipal-fiscal] no quarter files in ${DATA_DIR} — skipping.`,
    );
    return { quarters: 0, rows: 0 };
  }

  const rows: unknown[][] = [];
  for (const f of files) {
    // Malformed is NOT the same as absent: parse errors and shape violations
    // throw rather than degrading to "no data".
    const parsed = JSON.parse(
      readFileSync(resolve(DATA_DIR, f), "utf8"),
    ) as QuarterFile;
    if (!Array.isArray(parsed.rows) || parsed.rows.length === 0) {
      throw new Error(`${f}: no rows — refusing to publish an empty quarter`);
    }
    if (parsed.rows.length !== parsed.municipalityCount) {
      throw new Error(
        `${f}: municipalityCount ${parsed.municipalityCount} ≠ ${parsed.rows.length} rows`,
      );
    }
    for (const r of parsed.rows) rows.push(toRow(r));
  }

  await withClient(async (c) => {
    await createStageTable(c, SPEC);
    await copyRows(c, SPEC.source, SPEC.cols, rows);
    await addStagePrimaryKey(c, SPEC);
  });
  await withTx(async (c) => {
    await mergeFromStage(c, SPEC);
    // Same transaction as the merge, so the changelog can never describe a
    // corpus that failed to land. The key must survive a reload, so it is the
    // natural (município, period) rather than anything serial.
    await recordIngestBatch(c, {
      source: "municipal_fiscal",
      table: SPEC.table,
      keyExpr: "t.obshtina || '/' || t.fiscal_year || '-Q' || t.quarter",
      nameExpr: "t.name_bg",
      detailExpr:
        "t.fiscal_year || ' Q' || t.quarter || ' — поети ангажименти'",
      amountExpr: "t.commitments_eur::double precision",
      rowsTotal: rows.length,
    });
  });
  await exec(`DROP TABLE IF EXISTS ${SPEC.source}`);

  // Outside the transaction — VACUUM cannot run in one. A stage merge keeps the
  // visibility map, but carrying the call means a future switch to TRUNCATE
  // cannot silently give back index-only scans.
  await vacuumAfterReload(SPEC.table);

  return { quarters: files.length, rows: rows.length };
};

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  loadMunicipalFiscalPg()
    .then(({ quarters, rows }) => {
      console.log(
        `[municipal-fiscal] loaded ${rows} row(s) across ${quarters} quarter(s)`,
      );
      return end();
    })
    .catch(async (e) => {
      console.error(e);
      await end();
      process.exit(1);
    });
}
