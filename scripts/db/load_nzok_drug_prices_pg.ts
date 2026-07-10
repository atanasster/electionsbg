// Load the НЗОК per-hospital DRUG UNIT PRICE corpus into Postgres so the health
// pack's drug-price peer-comparison tile and the /company/:eik overpay tile are
// DB-served (multi-period, per-entity queries) instead of reading a single
// static snapshot. Two tables:
//   nzok_drug_pack_stats  — per (period, pack) median/p25/p75 dispersion band
//   nzok_drug_overpay     — the latest-full-year per-facility overpay ranking
//
//   npm run db:load:nzok-drug-prices:pg          (needs `npm run db:pg:up` first)
//   npm run db:load:nzok-drug-prices:pg:cloud    (targets the Cloud SQL proxy :5434)
//
// Source = data/budget/nzok/drug_unit_prices.json, produced by
// scripts/nzok/write_drug_unit_prices.ts. The two load-bearing rules (pack
// identity not INN; the 5-pack volume floor; dispersion ≠ wrongdoing) live in
// the parser and in 052_nzok_drug_unit_prices.sql — this loader only relays the
// precomputed rows into the tables verbatim.
//
// CAREFUL: the JSON `period` is "MM.YYYY" (e.g. "12.2025"). That string sorts
// month-first — "12.2025" > "05.2026" lexically — so we NEVER compare the raw
// string; every period is converted to a real date (first of the month) before
// it reaches the DB, and the DB sorts/compares on the date.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, withClient, end } from "./lib/pg";
import { recordIngestBatch } from "./lib/ingest_changelog";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const SCHEMA_FILE = path.join(
  REPO,
  "scripts/db/schema/pg/052_nzok_drug_unit_prices.sql",
);
const RISK_SCHEMA_FILE = path.join(
  REPO,
  "scripts/db/schema/pg/054_nzok_risk.sql",
);
const JSON_FILE = path.join(REPO, "data/budget/nzok/drug_unit_prices.json");

// "MM.YYYY" → "YYYY-MM-01". Throws on anything else so a shape change fails loud
// rather than silently loading a NULL period.
const periodToDate = (p: string): string => {
  const m = /^(\d{2})\.(\d{4})$/.exec(p);
  if (!m) throw new Error(`unexpected period format "${p}" (want MM.YYYY)`);
  return `${m[2]}-${m[1]}-01`;
};

interface PackStat {
  period: string;
  nationalNo?: string;
  nzokCode: string;
  inn?: string;
  tradeName?: string;
  form?: string;
  atc?: string;
  medianUnit: number;
  p25Unit: number;
  p75Unit: number;
  facilityCount: number;
  totalPacks: number;
  totalEur: number;
}

interface OverpayRow {
  nationalNo?: string;
  nzokCode: string;
  inn?: string;
  tradeName?: string;
  form?: string;
  facility: string;
  regNo: string;
  eik?: string | null;
  unitPrice: number;
  medianUnit: number;
  ratio: number;
  units: number;
  overpayEur: number;
}

interface OverpayByEik {
  eik: string;
  facility: string;
  overpayEur: number;
  packCount: number;
  innCount: number;
  maxRatio: number;
}

interface OverpayByInn {
  inn: string;
  overpayEur: number;
  facilityCount: number;
  packCount: number;
  maxRatio: number;
  packs: unknown[];
}

interface DrugPricesFile {
  volumeFloorPacks: number;
  periods: string[];
  latestFullYear: number;
  packStats: PackStat[];
  overpay: OverpayRow[];
  overpayByEik: OverpayByEik[];
  overpayByInn: OverpayByInn[];
}

// (period, national_no, nzok_code, inn, trade_name, form, atc,
//  median_unit_eur, p25_unit_eur, p75_unit_eur, facility_count, total_packs, total_eur)
type PackRow = [
  string,
  string,
  string,
  string | null,
  string | null,
  string | null,
  string | null,
  number,
  number,
  number,
  number,
  number,
  number,
];

// (period, national_no, nzok_code, inn, trade_name, form, facility, reg_no,
//  eik, unit_eur, median_unit_eur, ratio, units, overpay_eur)
type OverpayInsertRow = [
  string | null,
  string,
  string,
  string | null,
  string | null,
  string | null,
  string,
  string,
  string | null,
  number,
  number,
  number,
  number,
  number,
];

const PACK_COLS = [
  "period",
  "national_no",
  "nzok_code",
  "inn",
  "trade_name",
  "form",
  "atc",
  "median_unit_eur",
  "p25_unit_eur",
  "p75_unit_eur",
  "facility_count",
  "total_packs",
  "total_eur",
] as const;

const OVERPAY_COLS = [
  "period",
  "national_no",
  "nzok_code",
  "inn",
  "trade_name",
  "form",
  "facility",
  "reg_no",
  "eik",
  "unit_eur",
  "median_unit_eur",
  "ratio",
  "units",
  "overpay_eur",
] as const;

// Full per-hospital / per-INN drug-overpay aggregates for the risk views (054).
const BY_HOSPITAL_COLS = [
  "year",
  "eik",
  "facility",
  "overpay_eur",
  "pack_count",
  "inn_count",
  "max_ratio",
] as const;

const BY_INN_COLS = [
  "year",
  "inn",
  "overpay_eur",
  "facility_count",
  "pack_count",
  "max_ratio",
  "packs",
] as const;

const batchInsert = async (
  c: import("pg").PoolClient,
  table: string,
  cols: readonly string[],
  rows: unknown[][],
): Promise<void> => {
  const N = cols.length;
  const BATCH = Math.max(1, Math.floor(60000 / N)); // stay under the 65535 param cap
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const values = slice
      .map(
        (_, r) => `(${cols.map((_, col) => `$${r * N + col + 1}`).join(",")})`,
      )
      .join(",");
    await c.query(
      `INSERT INTO ${table} (${cols.join(",")}) VALUES ${values}`,
      slice.flat(),
    );
  }
};

const main = async (): Promise<void> => {
  if (!existsSync(JSON_FILE))
    throw new Error(
      `${JSON_FILE} missing — regenerate with:  npm run data:nzok -- --drug-prices`,
    );

  const data = JSON.parse(readFileSync(JSON_FILE, "utf8")) as DrugPricesFile;
  if (!Array.isArray(data.packStats) || data.packStats.length === 0)
    throw new Error(`${JSON_FILE} has no packStats[] — shape changed?`);
  if (!Array.isArray(data.overpay))
    throw new Error(`${JSON_FILE} has no overpay[] — shape changed?`);
  if (!Array.isArray(data.overpayByEik) || !Array.isArray(data.overpayByInn))
    throw new Error(
      `${JSON_FILE} has no overpayByEik[]/overpayByInn[] — regenerate the writer?`,
    );

  const packRows: PackRow[] = data.packStats.map((p) => [
    periodToDate(p.period),
    p.nationalNo ?? "",
    p.nzokCode,
    p.inn ?? null,
    p.tradeName ?? null,
    p.form ?? null,
    p.atc ?? null,
    p.medianUnit,
    p.p25Unit,
    p.p75Unit,
    p.facilityCount,
    p.totalPacks,
    p.totalEur,
  ]);

  // overpay is the latest-full-year ranking — annual, so period is NULL.
  const overpayRows: OverpayInsertRow[] = data.overpay.map((o) => [
    null,
    o.nationalNo ?? "",
    o.nzokCode,
    o.inn ?? null,
    o.tradeName ?? null,
    o.form ?? null,
    o.facility,
    o.regNo,
    o.eik ?? null,
    o.unitPrice,
    o.medianUnit,
    o.ratio,
    o.units,
    o.overpayEur,
  ]);

  const year = data.latestFullYear;
  const byHospitalRows = data.overpayByEik.map((h) => [
    year,
    h.eik,
    h.facility,
    h.overpayEur,
    h.packCount,
    h.innCount,
    h.maxRatio,
  ]);
  const byInnRows = data.overpayByInn.map((d) => [
    year,
    d.inn,
    d.overpayEur,
    d.facilityCount,
    d.packCount,
    d.maxRatio,
    JSON.stringify(d.packs),
  ]);

  await exec(readFileSync(SCHEMA_FILE, "utf8"));
  await exec(readFileSync(RISK_SCHEMA_FILE, "utf8"));

  const packEurSum = Math.round(packRows.reduce((a, r) => a + r[12], 0));
  const overpayEurSum = Math.round(overpayRows.reduce((a, r) => a + r[13], 0));

  await withClient(async (c) => {
    await c.query("BEGIN");
    await c.query("TRUNCATE nzok_drug_pack_stats");
    await c.query("TRUNCATE nzok_drug_overpay");

    await batchInsert(c, "nzok_drug_pack_stats", PACK_COLS, packRows);
    await batchInsert(c, "nzok_drug_overpay", OVERPAY_COLS, overpayRows);

    // No separate recent_updates entry: these two are DERIVED risk aggregates of
    // the same Справка 5 corpus, whose ingest is already itemised in the changelog
    // via nzok_drug_pack_stats below. The PG-changelog rule targets new SOURCE
    // datasets, not derived reshapes of one already tracked.
    await c.query("TRUNCATE nzok_drug_overpay_by_hospital");
    await c.query("TRUNCATE nzok_drug_overpay_by_inn");
    await batchInsert(
      c,
      "nzok_drug_overpay_by_hospital",
      BY_HOSPITAL_COLS,
      byHospitalRows,
    );
    await batchInsert(c, "nzok_drug_overpay_by_inn", BY_INN_COLS, byInnRows);

    // Post-load reconciliation — the DB must agree with what we loaded on BOTH
    // row counts and summed euros. A duplicate (period, national_no, nzok_code)
    // pack key would have thrown on INSERT already (no ON CONFLICT), but a
    // silent row loss or a numeric-cast drift is caught here; throwing rolls the
    // whole transaction back so a bad load never replaces a good table.
    const { rows: chk } = await c.query<{
      pn: number;
      ps: string;
      on: number;
      os: string;
    }>(
      `SELECT
         (SELECT count(*)::int              FROM nzok_drug_pack_stats) AS pn,
         (SELECT round(sum(total_eur))::bigint FROM nzok_drug_pack_stats) AS ps,
         (SELECT count(*)::int              FROM nzok_drug_overpay)    AS on,
         (SELECT round(sum(overpay_eur))::bigint FROM nzok_drug_overpay) AS os`,
    );
    if (
      chk[0].pn !== packRows.length ||
      Number(chk[0].ps) !== packEurSum ||
      chk[0].on !== overpayRows.length ||
      Number(chk[0].os) !== overpayEurSum
    )
      throw new Error(
        `post-load mismatch: pack ${chk[0].pn}/${chk[0].ps} vs ${packRows.length}/${packEurSum}; ` +
          `overpay ${chk[0].on}/${chk[0].os} vs ${overpayRows.length}/${overpayEurSum}`,
      );

    // "What changed" changelog — atomic with the load. Natural key = (period,
    // pack identity) so a TRUNCATE+reload dedups and only genuinely-new
    // pack-months itemise. Keyed on the pack-stats table (the durable series);
    // the overpay ranking is a derived annual view of the same corpus.
    await recordIngestBatch(c, {
      source: "nzok_drug_unit_price",
      table: "nzok_drug_pack_stats",
      keyExpr:
        "to_char(t.period,'YYYY-MM') || '|' || t.national_no || '|' || t.nzok_code",
      nameExpr: "coalesce(t.trade_name, t.inn)",
      detailExpr: "to_char(t.period, 'YYYY-MM')",
      amountExpr: "t.total_eur::double precision",
      rowsTotal: packRows.length,
    });

    await c.query("COMMIT");
  });

  const periods = new Set(packRows.map((r) => r[0]));
  const overpayWithEik = overpayRows.filter((r) => r[8]).length;
  console.log(
    `Loaded nzok_drug_pack_stats: ${packRows.length} rows · ${periods.size} periods · Σ €${packEurSum.toLocaleString("en")}\n` +
      `Loaded nzok_drug_overpay:    ${overpayRows.length} rows (latest full year ${data.latestFullYear}) · ${overpayWithEik} w/ eik · Σ overpay €${overpayEurSum.toLocaleString("en")}\n` +
      `Loaded risk aggregates:      ${byHospitalRows.length} hospitals · ${byInnRows.length} INNs\n` +
      `Volume floor: ${data.volumeFloorPacks} packs`,
  );
  await end();
};

main().catch(async (e) => {
  console.error(e);
  await end();
  process.exit(1);
});
