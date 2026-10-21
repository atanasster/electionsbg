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
 *  SEVEN, not six — and the numbering below is МФ'с own. The ministry's
 *  year-end workbooks enumerate the criteria explicitly, one column each, and
 *  they run 1..7:
 *
 *    1. плащания по общинския дълг      — debt SERVICE
 *    2. номинал на издадените гаранции  — guarantees
 *    3. налични задължения за разходи   — obligations      ✓ computable
 *    4. налични поети ангажименти       — commitments      ✓ computable
 *    5. налични просрочени задължения   — arrears          ✓ computable
 *    6. отрицателно салдо три години    — balance
 *    7. събираемост под средната        — collection
 *
 *  An earlier model had six and numbered obligations/commitments/arrears
 *  2/3/4 — it had dropped the GUARANTEES criterion and renumbered everything
 *  after it one low, so `criteria_met` indices named the wrong criteria. Verified
 *  against every Q4-anchored release in the cache (2016-2024): all seven, same
 *  order, every year.
 *
 *  ⚠️ SEVEN COLUMNS, SIX STATUTORY CONDITIONS — and the threshold counts the six.
 *  чл. 130а, ал. 1 ЗПФ (ДВ бр. 43/2016, unamended; read 2026-10-21) lists six:
 *  т. 1 „не се спазват фискалните правила по чл. 32, ал. 1 и 2", then the five
 *  that are МФ's 3–7. МФ SPLITS т. 1 into its two rules — чл. 32 ал. 1 (debt
 *  service ≤ 15%) is МФ 1, ал. 2 (guarantees ≤ 5%) is МФ 2. So `criteria_met`
 *  keeps МФ's seven-way numbering (it is МФ's data), but „three or more of the
 *  conditions" folds 1 and 2 into ONE: see `statutoryConditionsMet`. Measured
 *  2026-10-21, no year-end row breaches both, so no verdict moved — the fold
 *  matters the first time one does.
 *
 *  Three of the seven are computable here, and saying so is the point of the
 *  pair. МФ 1 needs debt SERVICE (плащания) — the workbook publishes only the
 *  debt STOCK. МФ 2 needs the guarantee nominal. МФ 6 needs three consecutive
 *  years of budget balance. МФ 7 needs the national collection mean. Reporting
 *  „2 met" without reporting „of 3 checked" invites the reader to apply the ≥3
 *  rule to a partial count. */
export const CRITERIA_TOTAL = 7;

/** How many чл. 130а ал. 1 CONDITIONS a set of МФ criteria satisfies: МФ 1 and 2
 *  are the two halves of statutory т. 1 and count once (see CRITERIA_TOTAL). */
export const statutoryConditionsMet = (met: readonly number[]): number =>
  new Set(met.map((c) => (c === 2 ? 1 : c))).size;

export const evaluateCriteria = (
  r: MunicipalFiscalQuarter,
): {
  met: number[] | null;
  evaluable: number[] | null;
  meetsThreshold: boolean | null;
} => {
  if (r.quarter !== 4)
    return { met: null, evaluable: null, meetsThreshold: null };

  // МФ'с OWN verdict wins wherever it reaches. It states all seven, so
  // `evaluable` is the full set and `meetsThreshold` becomes decisive in BOTH
  // directions — the derivation below can only ever prove TRUE, because three
  // of seven checked can reach three met but never rule it out.
  //
  // This is not a shortcut around the derivation: it is the difference between
  // „at least N of the three we could check" and „N, per the ministry". On the
  // year-ends it covers, nothing here is ours.
  //
  // ONE EXCEPTION, and it is the ministry's own ambiguity: МФ's „Брой на
  // критериите" counts its seven columns, while чл. 130а counts six conditions
  // (МФ 1+2 = т. 1). Where the two counts fall on OPPOSITE sides of three — both
  // debt rules breached plus exactly one more — the column count says „три" and
  // the statute says „две", and nothing in the release says which the ministry
  // applies. That case is NULL, with a warning naming the município, rather than
  // a silent override of the official figure either way. It has never occurred
  // (measured 2026-10-21).
  if (r.officialCriteriaMet) {
    const all = Array.from({ length: CRITERIA_TOTAL }, (_, i) => i + 1);
    const byColumns = r.officialCriteriaMet.length >= 3;
    const byConditions = statutoryConditionsMet(r.officialCriteriaMet) >= 3;
    if (byColumns !== byConditions)
      console.warn(
        `[municipal-fiscal] ${r.obshtina} (${r.nameBg}) ${r.fiscalYear}: МФ criteria ` +
          `[${r.officialCriteriaMet.join(",")}] are ${r.officialCriteriaMet.length} columns but ` +
          `${statutoryConditionsMet(r.officialCriteriaMet)} чл. 130а conditions — verdict left unknown`,
      );
    return {
      met: r.officialCriteriaMet,
      evaluable: all,
      meetsThreshold: byColumns === byConditions ? byConditions : null,
    };
  }

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
  // МФ's own numbering — see CRITERIA_TOTAL. These three are the computable
  // ones; 1, 2, 6 and 7 need inputs this workbook does not publish.
  // МФ 3 (= т. 2) — налични задължения за разходи > 15% of the 4-year average
  consider(3, r.ratios.obligationsPct, "expenseObligations", 15);
  // МФ 4 (= т. 3) — налични поети ангажименти > 50% of the 4-year average
  consider(4, r.ratios.commitmentsPct, "commitments", 50);
  // МФ 5 (= т. 4) — налични просрочени задължения > 5% of the year's reported expenditure
  consider(5, r.ratios.arrearsPct, "arrears", 5);

  // The чл. 130а rule is "three or more of the SIX conditions" (МФ 1+2 = т. 1),
  // and the criteria are MONOTONE:
  // an unevaluated one can only ever add to the count. So three met is already
  // decisive TRUE even with three unchecked, and — the other direction — a
  // verdict is only FALSE when every criterion was evaluable and fewer than
  // three were met. Everything between is genuinely unknown.
  const meetsThreshold =
    statutoryConditionsMet(met) >= 3
      ? true
      : evaluable.length === CRITERIA_TOTAL
        ? false
        : null;
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

const CENSUS_FILE = resolve(__dirname, "../../data/census_2021.json");

interface CensusMunicipality {
  code: string;
  nameBg: string;
  population: number;
}

/** Census obshtina code → the code `municipal_fiscal` uses.
 *
 *  264 of 265 are identical. The one that is not is Sofia: the census keys it
 *  `SOF46` (which is `place_dim.price_code`) while the fiscal corpus uses the
 *  governance code `SOF00`. Resolved from `place_dim` rather than hard-coded, so
 *  a future alias change moves in one place — but the RESULT is asserted
 *  against a full 265-row match below, because a silently unresolved Sofia
 *  would drop the largest município out of every per-resident ranking while
 *  leaving 264 rows that reconcile perfectly. */
export const resolveCensusCodes = (
  census: CensusMunicipality[],
  aliases: {
    code: string;
    governanceCode: string | null;
    priceCode: string | null;
  }[],
): Map<string, number> => {
  const byPrice = new Map<string, string>();
  for (const a of aliases) {
    if (a.priceCode) byPrice.set(a.priceCode, a.governanceCode ?? a.code);
  }
  const out = new Map<string, number>();
  for (const m of census) {
    if (!(m.population > 0)) continue;
    out.set(byPrice.get(m.code) ?? m.code, m.population);
  }
  return out;
};

/** Fill `obshtina_population` from NSI Census 2021.
 *
 *  Rebuilt wholesale each run — it is 265 rows off a committed file, so there
 *  is nothing to preserve and no reader to block. It REFUSES rather than
 *  degrades on an incomplete match: the per-resident ranking is the browse's
 *  default sort, so a município with no population silently sinks to the bottom
 *  of the page it most needs to be on. */
export const loadObshtinaPopulation = async (
  expectedObshtina: Set<string>,
): Promise<number> => {
  if (!existsSync(CENSUS_FILE)) {
    console.warn(
      `[municipal-fiscal] ${CENSUS_FILE} absent — no per-resident ranking.`,
    );
    return 0;
  }
  const census = JSON.parse(readFileSync(CENSUS_FILE, "utf8")) as {
    censusDate?: string;
    municipalities: CensusMunicipality[];
  };
  const aliases = await withClient((c) =>
    c
      .query<{
        code: string;
        governance_code: string | null;
        price_code: string | null;
      }>(
        `SELECT code, governance_code, price_code FROM place_dim
          WHERE kind = 'obshtina' AND price_code IS NOT NULL`,
      )
      .then((r) => r.rows),
  );
  const pop = resolveCensusCodes(
    census.municipalities,
    aliases.map((a) => ({
      code: a.code,
      governanceCode: a.governance_code,
      priceCode: a.price_code,
    })),
  );
  const missing = [...expectedObshtina].filter((o) => !pop.has(o)).sort();
  if (missing.length > 0) {
    throw new Error(
      `[municipal-fiscal] ${missing.length} município(s) have no census population ` +
        `(${missing.slice(0, 5).join(", ")}${missing.length > 5 ? " …" : ""}). ` +
        "The browse ranks per resident by default, so publishing this would sink " +
        "them to the bottom of the page rather than surface them. Check the code " +
        "alias in place_dim.price_code.",
    );
  }
  const year = Number((census.censusDate ?? "2021").slice(0, 4));
  await withTx(async (c) => {
    await c.query("TRUNCATE obshtina_population");
    await copyRows(
      c,
      "obshtina_population",
      ["obshtina", "population", "census_year"],
      [...pop].map(([o, n]) => [o, n, year]),
    );
  });
  return pop.size;
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

  // After the merge, so the expected roster is the corpus that just landed
  // rather than the previous vintage.
  const placed = await loadObshtinaPopulation(
    new Set(rows.map((r) => String(r[0]))),
  );
  console.log(`[municipal-fiscal] population dimension: ${placed} община`);

  // Outside the transaction — VACUUM cannot run in one. A stage merge keeps the
  // visibility map, but carrying the call means a future switch to TRUNCATE
  // cannot silently give back index-only scans.
  // `obshtina_population` is TRUNCATE-reloaded in one transaction, which is
  // exactly the shape that leaves relallvisible = 0 for ever. Small (2 pages)
  // but joined by all four subqueries in `municipal_fiscal_by_obshtina`, which
  // runs on 265 governance dashboards.
  await vacuumAfterReload(SPEC.table, "obshtina_population");

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
