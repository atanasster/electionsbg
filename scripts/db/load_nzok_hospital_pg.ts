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
import { createHash } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { exec, withClient, end } from "./lib/pg";
import { recordIngestBatch } from "./lib/ingest_changelog";
import {
  parseHospitalPaymentsPdf,
  type PaymentStream,
} from "../nzok/parse_hospital_payments";
import {
  bmpPaymentLinks,
  drugsPaymentLinks,
  devicesPaymentLinks,
} from "../nzok/lib/bmp_links";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const SCHEMA_FILE = path.join(
  REPO,
  "scripts/db/schema/pg/045_nzok_hospital_payments.sql",
);
// The trends/momentum functions (047) read the SAME table 045 loads, so apply
// both here — otherwise a fresh DB (or Cloud SQL after this loader runs) serves
// the pack's momentum + /company percentile endpoints off missing functions.
// CREATE OR REPLACE makes re-applying on every reload idempotent.
const TRENDS_SCHEMA_FILE = path.join(
  REPO,
  "scripts/db/schema/pg/047_nzok_hospital_trends.sql",
);
// 050 adds the `stream` dimension and REDEFINES the payload functions from 045 +
// 047. It must be applied last: it widens the primary key the INSERT below
// conflict-targets, and its versions of the trend functions pin `stream = 'bmp'`.
const STREAMS_SCHEMA_FILE = path.join(
  REPO,
  "scripts/db/schema/pg/050_nzok_payment_streams.sql",
);
// 065 adds the `ownership` column (state|municipal|private) + redefines the 050
// payload functions to carry it + the byOwnership private-vs-public split. Applied
// last so it supersedes 050's functions; idempotent CREATE OR REPLACE.
const OWNERSHIP_SCHEMA_FILE = path.join(
  REPO,
  "scripts/db/schema/pg/065_nzok_ownership.sql",
);
const RAW_DIR = path.join(REPO, "raw_data/nzok/bmp");
const EIK_FILE = path.join(REPO, "data/budget/nzok/hospital_eik.json");
// Committed Рег.№→ownership map (scripts/nzok/write_hospital_ownership.ts). Joined
// onto each row like eik; a facility absent here (or the file missing) loads with
// ownership NULL — reported as `unclassified`, never guessed.
const OWNERSHIP_FILE = path.join(
  REPO,
  "data/budget/nzok/hospital_ownership.json",
);
const BASE = "https://www.nhif.bg";
const UA = "electionsbg.com data pipeline";

// Years whose monthly files we attempt. 2023-2026 use the "Заплатени
// здравноосигурителни плащания за БМП" naming + the 2-column monthly layout the
// parser reconciles cleanly (early-year Jan/Feb files are 3-column and get
// skipped by the reconciliation assert). 2022-and-earlier shift naming/format
// (period-in-filename, wrap-drops) and need per-era link+parser work — tracked
// in scripts/nzok/README.md.
const YEARS = [2026, 2025, 2024, 2023];

// The three money streams NHIF publishes per month on the same listing page. A
// hospital's НЗОК income is their sum; loading only `bmp` (what this loader did
// originally) understates every facility. Each stream has its own link matcher
// and its own reconciliation assert inside the parser.
const STREAMS: { stream: PaymentStream; links: (html: string) => string[] }[] =
  [
    { stream: "bmp", links: bmpPaymentLinks },
    { stream: "drugs", links: drugsPaymentLinks },
    { stream: "devices", links: devicesPaymentLinks },
  ];

interface Row {
  reg_no: string;
  period: string; // YYYY-MM-01
  stream: PaymentStream;
  eik: string | null;
  name: string;
  rzok_code: string;
  rzok_name: string;
  cumulative_eur: number;
  month_eur: number;
  currency: string;
  ownership: string | null;
}

const fetchToCache = async (link: string): Promise<string> => {
  // Key the cache on a hash of the FULL link, not a positional path segment:
  // the source URL format shifts by era, so `/upload/<id>/file.pdf` is not a
  // stable assumption — two links sharing a segment must not alias to one file.
  const id = createHash("sha256").update(link).digest("hex").slice(0, 16);
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
  // The crosswalk writer only ever emits `entries[]`; a renamed/corrupted file
  // must fail loudly, not silently load the corpus with every eik = null.
  const eikArr: { regNo: string; eik: string | null }[] = eikFile.entries;
  if (!Array.isArray(eikArr) || eikArr.length === 0)
    throw new Error(`${EIK_FILE} has no entries[] — crosswalk shape changed?`);
  for (const e of eikArr) eikMap[e.regNo] = e.eik ?? null;

  // Рег.№→ownership (state|municipal|private). Optional: a missing file (older
  // checkout) just leaves every row's ownership NULL → served as `unclassified`.
  const ownMap: Record<string, string | null> = {};
  if (fs.existsSync(OWNERSHIP_FILE)) {
    const ownFile = JSON.parse(readFileSync(OWNERSHIP_FILE, "utf8"));
    const ownArr: { regNo: string; ownership: string | null }[] =
      ownFile.entries;
    if (!Array.isArray(ownArr))
      throw new Error(`${OWNERSHIP_FILE} has no entries[] — shape changed?`);
    for (const e of ownArr) ownMap[e.regNo] = e.ownership ?? null;
  } else {
    console.warn(
      `  (no ${path.basename(OWNERSHIP_FILE)} — rows load with ownership NULL; run --ownership)`,
    );
  }

  const rows: Row[] = [];
  const monthsSkipped: string[] = [];
  // Page order is newest-first, so the FIRST link resolving to a period is the
  // newest file. nhif.bg periodically re-issues a corrected month as a new
  // /upload/<id> while the superseded one lingers — dedup to one link per
  // period (newest wins) so a stale re-upload can't shadow the correction, and
  // log the skip so a correction is visible.
  // Dedup is per (stream, period): the three reports each publish their own file
  // for the same month, so a single set keyed on period alone would keep the БМП
  // file and discard the drugs/devices ones as "superseded duplicates".
  const seenPeriods = new Set<string>();
  let monthsOk = 0;
  for (const year of YEARS) {
    const pageUrl = `${BASE}/bg/hospitals/bmp/${year}`;
    const pageRes = await fetch(pageUrl, { headers: { "User-Agent": UA } });
    if (!pageRes.ok) throw new Error(`GET ${pageUrl} → ${pageRes.status}`);
    const html = await pageRes.text();
    for (const { stream, links } of STREAMS)
      for (const link of links(html)) {
        // Fetch OUTSIDE the try: a transport/HTTP error must ABORT the whole run,
        // never be swallowed as a "skipped month" — otherwise a transient nhif.bg
        // outage would TRUNCATE-replace the live table with a shrunken corpus.
        const pdf = await fetchToCache(link);
        let period = "";
        try {
          // Only PARSE/RECONCILE failures are skippable here (early-year 3-column
          // layout the parser can't yet reconcile) — those load later once the
          // parser is hardened. Network failures already aborted above.
          const f = parseHospitalPaymentsPdf(pdf, stream);
          period = `${f.year}-${String(f.month).padStart(2, "0")}-01`;
          const key = `${stream}::${period}`;
          if (seenPeriods.has(key)) {
            console.log(
              `  · superseded duplicate for ${key} (${link.slice(-24)}) — keeping newer`,
            );
            continue;
          }
          seenPeriods.add(key);
          for (const r of f.rows)
            rows.push({
              reg_no: r.regNo,
              period,
              stream,
              eik: eikMap[r.regNo] ?? null,
              name: r.name,
              rzok_code: r.rzokCode,
              rzok_name: r.rzokName,
              cumulative_eur: r.cumulativeEur,
              month_eur: r.monthEur,
              currency: f.currencyOfRecord,
              ownership: ownMap[r.regNo] ?? null,
            });
          monthsOk++;
        } catch (e) {
          monthsSkipped.push(
            `${stream} ${period || link.slice(-24)}: ${(e as Error).message.slice(0, 70)}`,
          );
        }
      }
  }
  return { rows, monthsOk, monthsSkipped };
};

const COLS = [
  "reg_no",
  "period",
  "stream",
  "eik",
  "name",
  "rzok_code",
  "rzok_name",
  "cumulative_eur",
  "month_eur",
  "currency",
  "ownership",
] as const;

const main = async (): Promise<void> => {
  await exec(readFileSync(SCHEMA_FILE, "utf8"));
  await exec(readFileSync(TRENDS_SCHEMA_FILE, "utf8"));
  // Last: 050 widens the PK the INSERT conflict-targets and supersedes the 045 +
  // 047 payload functions with their stream-aware / stream-pinned versions.
  await exec(readFileSync(STREAMS_SCHEMA_FILE, "utf8"));
  // 065 adds the ownership column + the byOwnership split (supersedes 050's fns).
  await exec(readFileSync(OWNERSHIP_SCHEMA_FILE, "utf8"));

  const { rows, monthsOk, monthsSkipped } = await collectRows();
  if (rows.length === 0)
    throw new Error("no НЗОК hospital-payment rows collected");

  const N = COLS.length;
  const BATCH = 800; // 800 × 10 = 8k params (< 65535)
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
         ON CONFLICT (reg_no, period, stream) DO NOTHING`,
        batch.flatMap((row) => COLS.map((col) => row[col])),
      );
    }
    // Post-load reconciliation — the DB must agree with what we collected.
    // `ON CONFLICT DO NOTHING` can silently drop rows (a same-(reg_no, period,
    // stream) dup), and a sub-tolerance parser misparse already shipped once
    // caught only by a MANUAL total check (see README). `mixed` also asserts the
    // single-currency-per-(period, stream) invariant the `min(currency)` serving
    // function relies on — the three reports switched to EUR together, but the
    // grouping now has to include `stream` or a legitimately BGN drugs file
    // alongside an EUR bmp file for the same month would read as a violation.
    // Throwing here rolls the whole transaction back.
    const jsSum = Math.round(rows.reduce((a, r) => a + r.cumulative_eur, 0));
    const { rows: chk } = await c.query<{
      n: number;
      s: string;
      mixed: number;
    }>(
      `SELECT count(*)::int AS n,
              round(sum(cumulative_eur))::bigint AS s,
              (SELECT count(*) FROM (
                 SELECT period, stream FROM nzok_hospital_payments
                 GROUP BY period, stream HAVING count(DISTINCT currency) > 1
               ) q)::int AS mixed
         FROM nzok_hospital_payments`,
    );
    if (
      chk[0].n !== rows.length ||
      Number(chk[0].s) !== jsSum ||
      Number(chk[0].mixed) !== 0
    )
      throw new Error(
        `post-load mismatch: db ${chk[0].n}/${chk[0].s} (mixed-currency periods ${chk[0].mixed}) vs collected ${rows.length}/${jsSum}`,
      );
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
