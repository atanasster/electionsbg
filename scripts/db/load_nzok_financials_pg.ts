// Load the ЕЕОФ per-hospital financials corpus (МЗ quarterly indicator sheet)
// into Postgres so the health pack can serve a latest-quarter national snapshot
// and a per-EIK quarterly series (revenue/expense/liabilities/overdue, staffing,
// bed occupancy, cost efficiency) DB-side instead of shipping a 9.9MB static JSON.
//
//   npm run db:load:nzok-financials:pg          (needs `npm run db:pg:up` first)
//   npm run db:load:nzok-financials:pg:cloud    (targets the Cloud SQL proxy :5434)
//
// Source = data/budget/nzok/hospital_financials.json, produced by
// scripts/nzok/write_eeof.ts. `eik` is joined by a conservative fold-and-match
// against the НЗОК Рег.№→EIK crosswalk (data/budget/nzok/hospital_eik.json) + the
// already-loaded payments table names — NULL when unmatched, never guessed.
//
// Two source quirks handled here (both reported, never shipped wrong):
//  * 8 municipal blocks (2019-Q4 → 2021-Q3) are a parser artifact — the ЛЗ name
//    collapsed to a bare oblast label, so ~4-5 distinct hospitals share one name.
//    Hospital identity is lost, the (quarter, ownership, name_fold) PK cannot hold,
//    and eik can never match. Those whole blocks are SKIPPED (listed on load).
//  * The `nzok` parity sheet has a stray duplicate (a zero row + the real row for
//    the same (quarter, Рег.№)); parity rows are aggregated by (quarter, reg_no).

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, withClient, end } from "./lib/pg";
import { recordIngestBatch } from "./lib/ingest_changelog";
import {
  fold,
  isJunk,
  partitionFoldCollisions,
  COLLISION_BUDGET,
} from "./lib/nzok_fold";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const SCHEMA_FILE = path.join(
  REPO,
  "scripts/db/schema/pg/051_nzok_hospital_financials.sql",
);
const DATA_FILE = path.join(REPO, "data/budget/nzok/hospital_financials.json");
const EIK_FILE = path.join(REPO, "data/budget/nzok/hospital_eik.json");

// `fold`, `isJunk`, `partitionFoldCollisions` and `COLLISION_BUDGET` live in
// ./lib/nzok_fold so the collision logic is unit-testable without a database.

interface FinRow {
  quarter: string;
  ownership: string;
  name: string;
  name_fold: string;
  eik: string | null;
  revenue_thousands_bgn: number | null;
  revenue_eur: number | null;
  expense_thousands_bgn: number | null;
  expense_eur: number | null;
  cost_efficiency_coef: number | null;
  personnel_cost_thousands_bgn: number | null;
  personnel_cost_eur: number | null;
  personnel_cost_share_pct: number | null;
  maintenance_cost_thousands_bgn: number | null;
  maintenance_cost_eur: number | null;
  maintenance_cost_share_pct: number | null;
  drugs_devices_cost_thousands_bgn: number | null;
  drugs_devices_cost_eur: number | null;
  drugs_devices_cost_share_pct: number | null;
  total_liabilities_thousands_bgn: number | null;
  total_liabilities_eur: number | null;
  overdue_liabilities_thousands_bgn: number | null;
  overdue_liabilities_eur: number | null;
  total_liabilities_revenue_share_pct: number | null;
  overdue_liabilities_revenue_share_pct: number | null;
  overdue_liabilities_expense_share_pct: number | null;
  patients_treated: number | null;
  avg_monthly_doctors: number | null;
  avg_monthly_nurses: number | null;
  patients_per_doctor: number | null;
  patients_per_nurse: number | null;
  avg_monthly_beds: number | null;
  bed_days: number | null;
  cost_per_bed_day_bgn: number | null;
  cost_per_bed_day_eur: number | null;
  cost_per_patient_bgn: number | null;
  cost_per_patient_eur: number | null;
  avg_length_of_stay: number | null;
  bed_occupancy_pct: number | null;
}

interface ParityRow {
  quarter: string;
  reg_no: string;
  rzok_code: string | null;
  name: string | null;
  pathway_count: number | null;
  bmp_eur: number;
  devices_eur: number;
  drugs_eur: number;
}

const FIN_COLS = [
  "quarter",
  "ownership",
  "name",
  "name_fold",
  "eik",
  "revenue_thousands_bgn",
  "revenue_eur",
  "expense_thousands_bgn",
  "expense_eur",
  "cost_efficiency_coef",
  "personnel_cost_thousands_bgn",
  "personnel_cost_eur",
  "personnel_cost_share_pct",
  "maintenance_cost_thousands_bgn",
  "maintenance_cost_eur",
  "maintenance_cost_share_pct",
  "drugs_devices_cost_thousands_bgn",
  "drugs_devices_cost_eur",
  "drugs_devices_cost_share_pct",
  "total_liabilities_thousands_bgn",
  "total_liabilities_eur",
  "overdue_liabilities_thousands_bgn",
  "overdue_liabilities_eur",
  "total_liabilities_revenue_share_pct",
  "overdue_liabilities_revenue_share_pct",
  "overdue_liabilities_expense_share_pct",
  "patients_treated",
  "avg_monthly_doctors",
  "avg_monthly_nurses",
  "patients_per_doctor",
  "patients_per_nurse",
  "avg_monthly_beds",
  "bed_days",
  "cost_per_bed_day_bgn",
  "cost_per_bed_day_eur",
  "cost_per_patient_bgn",
  "cost_per_patient_eur",
  "avg_length_of_stay",
  "bed_occupancy_pct",
] as const;

const PARITY_COLS = [
  "quarter",
  "reg_no",
  "rzok_code",
  "name",
  "pathway_count",
  "bmp_eur",
  "devices_eur",
  "drugs_eur",
] as const;

const num = (v: unknown): number | null =>
  v === null || v === undefined || v === "" || Number.isNaN(Number(v))
    ? null
    : Number(v);

const main = async (): Promise<void> => {
  if (!existsSync(DATA_FILE))
    throw new Error(
      `${DATA_FILE} missing — regenerate with:  npm run data:nzok -- --eeof`,
    );

  const j = JSON.parse(readFileSync(DATA_FILE, "utf8"));

  // Build the fold→eik lookup from the crosswalk first, then top up from the
  // already-loaded payments table names (some facilities are named there but not
  // in the crosswalk). First writer wins so the crosswalk is authoritative.
  const eikJson = JSON.parse(readFileSync(EIK_FILE, "utf8"));
  const eikArr: { name?: string; eik?: string | null }[] = eikJson.entries;
  if (!Array.isArray(eikArr) || eikArr.length === 0)
    throw new Error(`${EIK_FILE} has no entries[] — crosswalk shape changed?`);
  const foldToEik = new Map<string, string>();
  for (const e of eikArr) {
    if (!e.eik || !e.name) continue;
    const f = fold(e.name);
    if (f && !foldToEik.has(f)) foldToEik.set(f, e.eik);
  }
  let payNames = 0;
  await withClient(async (c) => {
    const { rows } = await c.query<{ name: string; eik: string }>(
      "SELECT DISTINCT name, eik FROM nzok_hospital_payments WHERE eik IS NOT NULL",
    );
    for (const r of rows) {
      const f = fold(r.name);
      if (f && !foldToEik.has(f)) foldToEik.set(f, r.eik);
      payNames++;
    }
  }).catch(() => {
    // The payments table is a nice-to-have for the join, not a hard dependency.
    console.warn(
      "  (nzok_hospital_payments not present — matching on crosswalk only)",
    );
  });

  if (!Array.isArray(j.quarters) || !Array.isArray(j.nzok))
    throw new Error(
      `${DATA_FILE} is missing quarters[]/nzok[] — shape changed? Regenerate with \`npm run data:nzok -- --eeof\`.`,
    );

  // Financials rows, degenerate blocks skipped, junk filtered.
  const finRows: FinRow[] = [];
  const skippedBlocks: string[] = [];
  let junkFiltered = 0;
  let collisionDropped = 0;
  for (const q of j.quarters as {
    quarter: string;
    ownership: string;
    hospitals: Record<string, unknown>[];
  }[]) {
    const clean = q.hospitals.filter((h) => !isJunk(String(h.name)));
    junkFiltered += q.hospitals.length - clean.length;
    // Drop only the colliding fold-groups, not the whole block (see nzok_fold).
    const { kept, dropped } = partitionFoldCollisions(clean, (h) =>
      String(h.name),
    );
    if (dropped > 0) {
      collisionDropped += dropped;
      skippedBlocks.push(
        `${q.quarter}/${q.ownership} (${dropped}/${clean.length} rows dropped on fold collision)`,
      );
    }
    for (const h of kept) {
      const nameFold = fold(String(h.name));
      finRows.push({
        quarter: q.quarter,
        ownership: q.ownership,
        name: String(h.name),
        name_fold: nameFold,
        eik: foldToEik.get(nameFold) ?? null,
        revenue_thousands_bgn: num(h.revenueThousandsBgn),
        revenue_eur: num(h.revenueEur),
        expense_thousands_bgn: num(h.expenseThousandsBgn),
        expense_eur: num(h.expenseEur),
        cost_efficiency_coef: num(h.costEfficiencyCoef),
        personnel_cost_thousands_bgn: num(h.personnelCostThousandsBgn),
        personnel_cost_eur: num(h.personnelCostEur),
        personnel_cost_share_pct: num(h.personnelCostSharePct),
        maintenance_cost_thousands_bgn: num(h.maintenanceCostThousandsBgn),
        maintenance_cost_eur: num(h.maintenanceCostEur),
        maintenance_cost_share_pct: num(h.maintenanceCostSharePct),
        drugs_devices_cost_thousands_bgn: num(h.drugsDevicesCostThousandsBgn),
        drugs_devices_cost_eur: num(h.drugsDevicesCostEur),
        drugs_devices_cost_share_pct: num(h.drugsDevicesCostSharePct),
        total_liabilities_thousands_bgn: num(h.totalLiabilitiesThousandsBgn),
        total_liabilities_eur: num(h.totalLiabilitiesEur),
        overdue_liabilities_thousands_bgn: num(
          h.overdueLiabilitiesThousandsBgn,
        ),
        overdue_liabilities_eur: num(h.overdueLiabilitiesEur),
        total_liabilities_revenue_share_pct: num(
          h.totalLiabilitiesRevenueSharePct,
        ),
        overdue_liabilities_revenue_share_pct: num(
          h.overdueLiabilitiesRevenueSharePct,
        ),
        overdue_liabilities_expense_share_pct: num(
          h.overdueLiabilitiesExpenseSharePct,
        ),
        patients_treated: num(h.patientsTreated),
        avg_monthly_doctors: num(h.avgMonthlyDoctors),
        avg_monthly_nurses: num(h.avgMonthlyNurses),
        patients_per_doctor: num(h.patientsPerDoctor),
        patients_per_nurse: num(h.patientsPerNurse),
        avg_monthly_beds: num(h.avgMonthlyBeds),
        bed_days: num(h.bedDays),
        cost_per_bed_day_bgn: num(h.costPerBedDayBgn),
        cost_per_bed_day_eur: num(h.costPerBedDayEur),
        cost_per_patient_bgn: num(h.costPerPatientBgn),
        cost_per_patient_eur: num(h.costPerPatientEur),
        avg_length_of_stay: num(h.avgLengthOfStay),
        bed_occupancy_pct: num(h.bedOccupancyPct),
      });
    }
  }
  if (finRows.length === 0)
    throw new Error("no ЕЕОФ financials rows collected");

  // Parity sheet, aggregated by (quarter, reg_no) — sums a stray duplicate (zero
  // row + real row) so the PK holds and the money is preserved.
  const parityAgg = new Map<string, ParityRow>();
  for (const r of j.nzok as Record<string, unknown>[]) {
    const key = `${String(r.quarter)}|${String(r.regNo)}`;
    const cur = parityAgg.get(key);
    if (cur) {
      cur.bmp_eur += num(r.bmpEur) ?? 0;
      cur.devices_eur += num(r.devicesEur) ?? 0;
      cur.drugs_eur += num(r.drugsEur) ?? 0;
      cur.pathway_count =
        Math.max(cur.pathway_count ?? 0, num(r.pathwayCount) ?? 0) ||
        cur.pathway_count;
      if (!cur.name && r.name) cur.name = String(r.name);
    } else {
      parityAgg.set(key, {
        quarter: String(r.quarter),
        reg_no: String(r.regNo),
        rzok_code: r.rzokCode ? String(r.rzokCode) : null,
        name: r.name ? String(r.name) : null,
        pathway_count: num(r.pathwayCount),
        bmp_eur: num(r.bmpEur) ?? 0,
        devices_eur: num(r.devicesEur) ?? 0,
        drugs_eur: num(r.drugsEur) ?? 0,
      });
    }
  }
  const parityRows = [...parityAgg.values()];

  await exec(readFileSync(SCHEMA_FILE, "utf8"));

  // Rows are the typed FinRow/ParityRow structs — accepted as `object[]` so the
  // call sites need no cast (the old code laundered them through
  // `as unknown as Record<string, unknown>[]`, defeating key↔column checking).
  // The single internal cast is scoped to the column read.
  const insertBatched = async (
    c: import("pg").PoolClient,
    table: string,
    cols: readonly string[],
    rows: readonly object[],
  ): Promise<void> => {
    const N = cols.length;
    const BATCH = Math.max(1, Math.floor(60000 / N));
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values = batch
        .map(
          (_, r) =>
            `(${cols.map((_, col) => `$${r * N + col + 1}`).join(",")})`,
        )
        .join(",");
      await c.query(
        `INSERT INTO ${table} (${cols.join(",")}) VALUES ${values}`,
        batch.flatMap((row) =>
          cols.map((col) => (row as Record<string, unknown>)[col]),
        ),
      );
    }
  };

  const finEurSum = Math.round(
    finRows.reduce((a, r) => a + (r.revenue_eur ?? 0), 0),
  );
  const parityBmpSum = Math.round(
    parityRows.reduce((a, r) => a + r.bmp_eur, 0),
  );

  // Guard BEFORE writing anything (see COLLISION_BUDGET in ./lib/nzok_fold): a
  // jump past the known bare-oblast envelope means a NEW clean-quarter collision,
  // so abort rather than silently erase real rows. Pre-transaction, so a tripped
  // budget never leaves a half-updated table.
  if (collisionDropped > COLLISION_BUDGET)
    throw new Error(
      `fold collisions (${collisionDropped}) exceed the known ${COLLISION_BUDGET}-row bare-oblast envelope — a clean-quarter collision likely; inspect before loading:\n  ${skippedBlocks.join("\n  ")}`,
    );

  await withClient(async (c) => {
    await c.query("BEGIN");
    await c.query("TRUNCATE nzok_hospital_financials");
    await c.query("TRUNCATE nzok_eeof_nzok_parity");
    await insertBatched(c, "nzok_hospital_financials", FIN_COLS, finRows);
    await insertBatched(c, "nzok_eeof_nzok_parity", PARITY_COLS, parityRows);

    // Post-load reconciliation: row counts + summed revenue/bmp must agree with
    // what we collected. A mismatch (a silently-dropped row, a duplicate that
    // slipped the PK) throws and rolls the whole transaction back.
    const { rows: chk } = await c.query<{
      fn: number;
      fs: string;
      pn: number;
      ps: string;
    }>(
      `SELECT (SELECT count(*)::int FROM nzok_hospital_financials) AS fn,
              (SELECT round(sum(revenue_eur))::bigint FROM nzok_hospital_financials) AS fs,
              (SELECT count(*)::int FROM nzok_eeof_nzok_parity) AS pn,
              (SELECT round(sum(bmp_eur))::bigint FROM nzok_eeof_nzok_parity) AS ps`,
    );
    if (
      chk[0].fn !== finRows.length ||
      Number(chk[0].fs) !== finEurSum ||
      chk[0].pn !== parityRows.length ||
      Number(chk[0].ps) !== parityBmpSum
    )
      throw new Error(
        `post-load mismatch: financials db ${chk[0].fn}/${chk[0].fs} vs ${finRows.length}/${finEurSum}; ` +
          `parity db ${chk[0].pn}/${chk[0].ps} vs ${parityRows.length}/${parityBmpSum}`,
      );

    // "What changed" changelog — atomic with the load. Natural key = (hospital,
    // quarter) so a TRUNCATE+reload dedups and only new quarters itemise.
    await recordIngestBatch(c, {
      source: "nzok_hospital_financials",
      table: "nzok_hospital_financials",
      keyExpr: "t.name_fold || '|' || t.ownership || '|' || t.quarter",
      nameExpr: "t.name",
      detailExpr: "t.quarter",
      amountExpr: "t.revenue_eur::double precision",
      rowsTotal: finRows.length,
    });
    await c.query("COMMIT");
  });

  const matched = finRows.filter((r) => r.eik).length;
  const revTot = finRows.reduce((a, r) => a + (r.revenue_eur ?? 0), 0);
  const revMatched = finRows
    .filter((r) => r.eik)
    .reduce((a, r) => a + (r.revenue_eur ?? 0), 0);
  const quarters = new Set(finRows.map((r) => r.quarter)).size;

  console.log(
    `Loaded ${finRows.length} financials rows · ${quarters} quarters · ` +
      `${parityRows.length} parity rows`,
  );
  console.log(
    `eik matched: ${matched}/${finRows.length} (${((100 * matched) / finRows.length).toFixed(1)}% rows, ` +
      `${((100 * revMatched) / revTot).toFixed(1)}% by revenue) · fold map ${foldToEik.size} keys (+${payNames} payment names)`,
  );
  if (junkFiltered) console.log(`Filtered ${junkFiltered} junk/header row(s).`);
  if (skippedBlocks.length) {
    console.log(
      `Dropped ${collisionDropped} fold-collision row(s) across ${skippedBlocks.length} block(s) (parser lost hospital identity — bare oblast labels):`,
    );
    skippedBlocks.forEach((b) => console.log(`  - ${b}`));
  }
  await end();
};

main().catch(async (e) => {
  console.error(e);
  await end();
  process.exit(1);
});
