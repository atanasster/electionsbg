// Load the НЗОК per-hospital БМП payments corpus into Postgres so the health
// pack's payments tile and the /company/:eik reimbursement tile are DB-served
// (multi-period, per-entity queries) instead of reading a single static snapshot.
//
//   npm run db:load:nzok-hospital:pg          (needs `npm run db:pg:up` first)
//   npm run db:load:nzok-hospital:pg:cloud    (targets the Cloud SQL proxy :5434)
//
// Source = the monthly БМП PDFs on nhif.bg, parsed with the shared
// reconciliation-asserted parser; eik is joined from the Рег.№→EIK crosswalk
// (data/budget/nzok/hospital_eik.json). We load only the months that PARSE +
// RECONCILE cleanly — currently 2023-2026 (see YEARS). Any month the parser
// can't reconcile is skipped, not shipped wrong; the remaining backfill tail
// (a few early-year files + ≤2022's shifted naming/format) is tracked in
// scripts/nzok/README.md and loads into the same table as each era is hardened.

import { readFileSync } from "node:fs";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { exec, withClient, end } from "./lib/pg";
import { recordIngestBatch } from "./lib/ingest_changelog";
import { parseHospitalPaymentsPdf } from "../nzok/parse_hospital_payments";
import { bmpPaymentLinks } from "../nzok/lib/bmp_links";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const SCHEMA_FILE = path.join(
  REPO,
  "scripts/db/schema/pg/045_nzok_hospital_payments.sql",
);
const RAW_DIR = path.join(REPO, "raw_data/nzok/bmp");
const EIK_FILE = path.join(REPO, "data/budget/nzok/hospital_eik.json");
const BASE = "https://www.nhif.bg";
const UA = "electionsbg.com data pipeline";

// Years whose monthly files we attempt. 2023-2026 use the "Заплатени
// здравноосигурителни плащания за БМП" naming + the 2-column monthly layout the
// parser reconciles cleanly (early-year Jan/Feb files are 3-column and get
// skipped by the reconciliation assert). 2022-and-earlier shift naming/format
// (period-in-filename, wrap-drops) and need per-era link+parser work — tracked
// in scripts/nzok/README.md.
const YEARS = [2026, 2025, 2024, 2023];

interface Row {
  reg_no: string;
  period: string; // YYYY-MM-01
  eik: string | null;
  name: string;
  rzok_code: string;
  rzok_name: string;
  cumulative_eur: number;
  month_eur: number;
  currency: string;
}

const fetchToCache = async (link: string): Promise<string> => {
  const id = link.split("/")[2];
  const p = path.join(RAW_DIR, `clean_${id}.pdf`);
  if (!fs.existsSync(p)) {
    const res = await fetch(BASE + link, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`GET ${link} → ${res.status}`);
    fs.mkdirSync(RAW_DIR, { recursive: true });
    fs.writeFileSync(p, Buffer.from(await res.arrayBuffer()));
  }
  return p;
};

const collectRows = async (): Promise<{
  rows: Row[];
  monthsOk: number;
  monthsSkipped: string[];
}> => {
  const eikMap: Record<string, string | null> = {};
  const eikFile = JSON.parse(readFileSync(EIK_FILE, "utf8"));
  const eikArr: { regNo: string; eik: string | null }[] =
    eikFile.entries ?? eikFile.crosswalk ?? eikFile.facilities ?? [];
  for (const e of eikArr) eikMap[e.regNo] = e.eik ?? null;

  const rows: Row[] = [];
  const monthsSkipped: string[] = [];
  let monthsOk = 0;
  for (const year of YEARS) {
    const html = await (
      await fetch(`${BASE}/bg/hospitals/bmp/${year}`, {
        headers: { "User-Agent": UA },
      })
    ).text();
    for (const link of bmpPaymentLinks(html)) {
      let period = "";
      try {
        const pdf = await fetchToCache(link);
        const f = parseHospitalPaymentsPdf(pdf);
        period = `${f.year}-${String(f.month).padStart(2, "0")}-01`;
        for (const r of f.rows)
          rows.push({
            reg_no: r.regNo,
            period,
            eik: eikMap[r.regNo] ?? null,
            name: r.name,
            rzok_code: r.rzokCode,
            rzok_name: r.rzokName,
            cumulative_eur: r.cumulativeEur,
            month_eur: r.monthEur,
            currency: f.currencyOfRecord,
          });
        monthsOk++;
      } catch (e) {
        // Skip months the parser can't yet reconcile (early-year 3-column
        // layout) — they load later once the parser is hardened.
        monthsSkipped.push(
          `${period || link.slice(-24)}: ${(e as Error).message.slice(0, 70)}`,
        );
      }
    }
  }
  return { rows, monthsOk, monthsSkipped };
};

const COLS = [
  "reg_no",
  "period",
  "eik",
  "name",
  "rzok_code",
  "rzok_name",
  "cumulative_eur",
  "month_eur",
  "currency",
] as const;

const main = async (): Promise<void> => {
  await exec(readFileSync(SCHEMA_FILE, "utf8"));

  const { rows, monthsOk, monthsSkipped } = await collectRows();
  if (rows.length === 0)
    throw new Error("no НЗОК hospital-payment rows collected");

  const N = COLS.length;
  const BATCH = 1000; // 1000 × 9 = 9k params (< 65535)
  await withClient(async (c) => {
    await c.query("BEGIN");
    await c.query("TRUNCATE nzok_hospital_payments");
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values = batch
        .map(
          (_, r) =>
            `(${COLS.map((_, col) => `$${r * N + col + 1}`).join(",")})`,
        )
        .join(",");
      await c.query(
        `INSERT INTO nzok_hospital_payments (${COLS.join(",")}) VALUES ${values}
         ON CONFLICT (reg_no, period) DO NOTHING`,
        batch.flatMap((row) => COLS.map((col) => row[col])),
      );
    }
    // "What changed" changelog — atomic with the load. Natural key = (facility,
    // period) so a TRUNCATE+reload dedups and only genuinely-new months itemise.
    await recordIngestBatch(c, {
      source: "nzok_hospital_payment",
      table: "nzok_hospital_payments",
      keyExpr: "t.reg_no || '|' || t.period::text",
      nameExpr: "t.name",
      detailExpr: "to_char(t.period, 'YYYY-MM')",
      amountExpr: "t.cumulative_eur::double precision",
      rowsTotal: rows.length,
    });
    await c.query("COMMIT");
  });

  const months = new Set(rows.map((r) => r.period)).size;
  const matched = rows.filter((r) => r.eik).length;

  console.log(
    `Loaded ${rows.length} rows · ${months} periods · ${monthsOk} months OK · ${matched} rows w/ eik (${((100 * matched) / rows.length).toFixed(0)}%)`,
  );
  if (monthsSkipped.length) {
    console.log(
      `Skipped ${monthsSkipped.length} months (parser hardening TODO):`,
    );

    monthsSkipped.forEach((m) => console.log(`  - ${m}`));
  }
  await end();
};

main().catch(async (e) => {
  console.error(e);
  await end();
  process.exit(1);
});
