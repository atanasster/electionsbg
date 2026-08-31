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
// (≤2022's shifted naming/format) is tracked in scripts/nzok/README.md and loads
// into the same table as each era is hardened.
//
// ⚠️ Within YEARS the expected skip count is ZERO. It was 24 of 127 until the
// completeness work in docs/plans/nzok-hospital-parser-hardening-v1.md: 14 files
// were withheld over money the parser was reading wrong, and 10 over НЗОК's own
// facility count, which means different things in different eras and is now
// REPORTED (`countMismatches`) rather than asserted. A skip printed today is a
// month the site does not have.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exec, withClient, end, vacuumAfterReload } from "./lib/pg";
import { recordIngestBatch } from "./lib/ingest_changelog";
import { appendDataChange } from "../lib/data-changes";
import {
  HospitalPaymentsRefusal,
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
// 187 is the COVERAGE table — one row per (stream, period) the listing offered,
// published or not. Applied here because this loader is its only writer; a month
// is only known to be missing by the process that tried to load it.
const COVERAGE_SCHEMA_FILE = path.join(
  REPO,
  "scripts/db/schema/pg/187_nzok_payment_coverage.sql",
);
// Overridable so the --tolerate-offline path can be exercised deterministically
// (point it at an unroutable address); production never sets it.
const BASE = process.env.NZOK_BASE_URL ?? "https://www.nhif.bg";
const UA = "electionsbg.com data pipeline";

// Years whose monthly files we attempt. 2023-2026 use the "Заплатени
// здравноосигурителни плащания за БМП" naming, in both the 2- and 3-column
// monthly layouts — the January/February files are 3-column and DO load; the note
// here said they were "skipped by the reconciliation assert", which was true only
// while the January files were failing НЗОК's facility count. 2022-and-earlier
// shift naming/format (period-in-filename, wrap-drops) and need per-era
// link+parser work — tracked in scripts/nzok/README.md.
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

/** A row of `nzok_payment_coverage` (migration 187). */
export interface CoverageRow {
  stream: PaymentStream;
  period: string;
  status: "loaded" | "refused";
  header_facility_count: number | null;
  header_total_eur: number | null;
  rows_loaded: number;
  rows_total_eur: number;
  reason: string | null;
  /** NULL on a refused month: nothing was checked, and 0 would claim it was. */
  count_mismatch_blocks: number | null;
  count_mismatch_ordinals: number | null;
  unreconciled_blocks: number | null;
  unreconciled_eur: number | null;
  republishes_period: string | null;
}

export interface Row {
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

// A transport/HTTP failure against nhif.bg. Distinct from parse errors so the
// `--tolerate-offline` path (the db:refresh chain) can skip THIS class only:
// "the source is unreachable" is the absent-input case, "the source parsed
// wrong" stays a hard failure everywhere.
class NhifNetworkError extends Error {}

const fetchNhif = async (url: string): Promise<Response> => {
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": UA } });
  } catch (e) {
    throw new NhifNetworkError(`GET ${url} → ${(e as Error).message}`);
  }
  if (!res.ok) throw new NhifNetworkError(`GET ${url} → ${res.status}`);
  return res;
};

const fetchToCache = async (link: string): Promise<string> => {
  // Key the cache on a hash of the FULL link, not a positional path segment:
  // the source URL format shifts by era, so `/upload/<id>/file.pdf` is not a
  // stable assumption — two links sharing a segment must not alias to one file.
  const id = createHash("sha256").update(link).digest("hex").slice(0, 16);
  const p = path.join(RAW_DIR, `clean_${id}.pdf`);
  if (!fs.existsSync(p)) {
    const res = await fetchNhif(BASE + link);
    fs.mkdirSync(RAW_DIR, { recursive: true });
    fs.writeFileSync(p, Buffer.from(await res.arrayBuffer()));
  }
  return p;
};

/** The coverage row for a month that PUBLISHED. */
export const loadedCoverageRow = (
  stream: PaymentStream,
  period: string,
  f: {
    headerFacilityCount: number;
    totalCumulativeEur: number;
    rows: { cumulativeEur: number }[];
    countMismatches: { missingOrdinals: number[]; extraOrdinals: number[] }[];
    unreconciledBlocks: string[];
    unreconciledEur: number;
  },
): CoverageRow => ({
  stream,
  period,
  status: "loaded",
  // 0 means "unreadable", which is not a count of zero facilities.
  header_facility_count: f.headerFacilityCount || null,
  header_total_eur: f.totalCumulativeEur || null,
  rows_loaded: f.rows.length,
  rows_total_eur: Math.round(f.rows.reduce((a, r) => a + r.cumulativeEur, 0)),
  reason: null,
  count_mismatch_blocks: f.countMismatches.length,
  count_mismatch_ordinals: f.countMismatches.reduce(
    (n, m) => n + m.missingOrdinals.length + m.extraOrdinals.length,
    0,
  ),
  unreconciled_blocks: f.unreconciledBlocks.length,
  unreconciled_eur: Math.round(f.unreconciledEur),
  // Stamped after the whole walk — a republication is only knowable against the
  // month before it, which may not be parsed yet.
  republishes_period: null,
});

/** The coverage row for a month that was REFUSED — carrying what НЗОК said it was
 *  worth, which is the whole reason the refusal is a typed error.
 *
 *  ⚠️ The four "not verified" counters are NULL here, not 0. Zero means "checked
 *  and clean"; nothing was checked, because the refusal fired first. Publishing 0
 *  would say a withheld month's blocks all reconcile. */
export const refusedCoverageRow = (
  stream: PaymentStream,
  period: string,
  reason: string,
  facts: { headerFacilityCount: number; totalCumulativeEur: number },
): CoverageRow => ({
  stream,
  period,
  status: "refused",
  header_facility_count: facts.headerFacilityCount || null,
  header_total_eur: facts.totalCumulativeEur || null,
  rows_loaded: 0,
  rows_total_eur: 0,
  reason,
  count_mismatch_blocks: null,
  count_mismatch_ordinals: null,
  unreconciled_blocks: null,
  unreconciled_eur: null,
  republishes_period: null,
});

const collectRows = async (): Promise<{
  rows: Row[];
  monthsOk: number;
  monthsSkipped: string[];
  /** One row per (stream, period) the listing offered, published or not — see
   *  migration 187. Built here because this is the only place that knows a month
   *  was OFFERED and refused; downstream, a refused month is indistinguishable
   *  from one НЗОК never published. */
  coverage: CoverageRow[];
  /** Per accepted month: what the parser could NOT verify. Carried out of the
   *  parse so a RISING figure is visible at load time — the whole point of §9-3 is
   *  that these are reported rather than thrown, and a report nobody surfaces is
   *  the same as no report. This is also the shape Tier 0's coverage row stores. */
  notVerified: {
    stream: PaymentStream;
    period: string;
    countMismatchBlocks: number;
    missingOrdinals: number;
    extraOrdinals: number;
    unreconciledBlocks: number;
    unreconciledEur: number;
  }[];
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
  const coverage: CoverageRow[] = [];
  const notVerified: {
    stream: PaymentStream;
    period: string;
    countMismatchBlocks: number;
    missingOrdinals: number;
    extraOrdinals: number;
    unreconciledBlocks: number;
    unreconciledEur: number;
  }[] = [];
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
    const pageRes = await fetchNhif(pageUrl);
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
          // ⚠️ ONE dedup guard for BOTH outcomes, keyed the same way the
          // payments dedup is. Guarding only the refused push left the loaded one
          // free to add a second row for a (stream, period) the other outcome had
          // already claimed — and the listing DOES serve a period under two hrefs
          // (three today). That is a primary-key violation mid-transaction, which
          // rolls back the entire load: the coverage table would have taken the
          // corpus down with it.
          if (!coverage.some((c) => c.stream === stream && c.period === period))
            coverage.push(loadedCoverageRow(stream, period, f));
          if (f.countMismatches.length || f.unreconciledBlocks.length)
            notVerified.push({
              stream,
              period,
              countMismatchBlocks: f.countMismatches.length,
              missingOrdinals: f.countMismatches.reduce(
                (n, m) => n + m.missingOrdinals.length,
                0,
              ),
              // A block can also carry MORE ordinals than it counts — bmp 2026-06's
              // Русе prints 7 and numbers an 8th. Without this the line reads
              // "1 block(s) miscounted, 0 ordinal(s) absent", which names a
              // disagreement and then says nothing disagrees.
              extraOrdinals: f.countMismatches.reduce(
                (n, m) => n + m.extraOrdinals.length,
                0,
              ),
              unreconciledBlocks: f.unreconciledBlocks.length,
              unreconciledEur: f.unreconciledEur,
            });
          monthsOk++;
        } catch (e) {
          // ⚠️ NOT truncated, and the repo prefix is stripped. This used to be
          // `.slice(0, 70)` against a message that LEADS with a ~70-character
          // absolute pdfPath, so every line read
          // "block reconciliation failed for /Users/…/raw_data/nzo" and the
          // operator never reached the part that says which block or by how much.
          // §1 of docs/plans/nzok-hospital-parser-hardening-v1.md names this exact
          // truncation as the reason the original investigation had to bypass the
          // loader and parse the PDFs directly. A skip is now expected to be rare
          // (0 today), so there is nothing left to keep the output short for.
          const reason = (e as Error).message.split(`${REPO}/`).join("");
          monthsSkipped.push(
            `${stream} ${period || link.slice(-24)}: ${reason}`,
          );
          // ⚠️ A refusal still knows which month it refused and what НЗОК said it
          // was worth — see `HospitalPaymentsRefusal`. Without this the coverage
          // table would record only the months that loaded, which is precisely the
          // silence it exists to break. A document that is not a report at all
          // (pdftotext failed, no „към" period) has no month to key on and is
          // reported in the console only.
          if (e instanceof HospitalPaymentsRefusal) {
            const p = `${e.facts.asOf.slice(0, 7)}-01`;
            if (!coverage.some((c) => c.stream === stream && c.period === p))
              coverage.push(refusedCoverageRow(stream, p, reason, e.facts));
          }
        }
      }
  }
  // RC-5 — a republication is only knowable against the month before it, so it is
  // stamped after the whole walk rather than per file.
  for (const r of republishedMonths(rows)) {
    const c = coverage.find(
      (x) => x.stream === r.stream && x.period === r.period,
    );
    if (c) c.republishes_period = r.prior;
  }
  return { rows, monthsOk, monthsSkipped, notVerified, coverage };
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

/**
 * Months НЗОК published that repeat their predecessor's year-to-date with NO flow
 * of their own — the same corpus figures under a later „към" date and a month
 * column of zero.
 *
 * ⚠️ These are PUBLISHED as filed, deliberately (RC-5 / §9-1 of
 * docs/plans/nzok-hospital-parser-hardening-v1.md). A zero month is a fact НЗОК
 * put its name to, and withholding it creates a hole in the series that reads as
 * our defect rather than theirs — the reader cannot tell "we refused this month"
 * from "the parser broke". What is NOT acceptable is publishing it silently: on a
 * page that shows a per-hospital € beside a date, April carrying March's figures
 * is a claim about named hospitals, and a reader comparing the two months would
 * conclude nothing was paid in April.
 *
 * So the decision is: publish, and say so. This is the fact Tier 0's coverage row
 * records; until that exists it is a line in the loader's output, which is the
 * same bargain `unreconciledBlocks` strikes inside the parser.
 *
 * ONE month in the cache does this — devices 2026-04, whose €31,273,942 is
 * March's to the euro. It is not a parser artifact: both files parse cleanly, and
 * the April document's own month column is zero throughout.
 */
export const republishedMonths = (
  rows: Row[],
): {
  stream: PaymentStream;
  period: string;
  prior: string;
  cumulativeEur: number;
}[] => {
  const totals = new Map<
    string,
    { cum: number; month: number; zeroRows: boolean }
  >();
  for (const r of rows) {
    const k = `${r.stream}|${r.period}`;
    const t = totals.get(k) ?? { cum: 0, month: 0, zeroRows: true };
    t.cum += r.cumulative_eur;
    t.month += r.month_eur;
    // ⚠️ EVERY row's month must be zero, not merely their sum. A month whose
    // per-facility flows offset to zero is a different fact, and the banner this
    // drives says "no payments at all in the later one" — which would then be
    // false about named hospitals. Negatives are real here: devices 2025-12 nets
    // −€2,127 across its rows.
    if (r.month_eur !== 0) t.zeroRows = false;
    totals.set(k, t);
  }

  /** The calendar month before `YYYY-MM-01`, or null across a year boundary.
   *
   *  ⚠️ Null in January BY DESIGN. These reports are YEAR-TO-DATE, so a January
   *  cumulative RESETS — comparing it against December asks whether two figures on
   *  different bases happen to be equal, which is not a question about the data.
   *  (It also cannot currently fire, because a zero-month January has a zero
   *  cumulative too and is excluded below; that is an accident of the arithmetic
   *  and not something to rely on.) */
  const priorMonth = (period: string): string | null => {
    const [y, m] = period.split("-").map(Number);
    return m === 1 ? null : `${y}-${String(m - 1).padStart(2, "0")}-01`;
  };

  const out: {
    stream: PaymentStream;
    period: string;
    prior: string;
    cumulativeEur: number;
  }[] = [];
  for (const [k, t] of totals) {
    const [stream, period] = k.split("|") as [PaymentStream, string];
    // A zero month is the entry condition. An ordinary month has a flow, and a
    // January legitimately has month == YTD.
    if (!t.zeroRows || t.cum === 0) continue;
    // …and it is only a REPUBLICATION if the month immediately before it carries
    // the same year-to-date.
    //
    // ⚠️ The IMMEDIATELY preceding calendar month, never "the nearest earlier file
    // we happen to hold". The devices stream has real gaps — there is no 2024-01 —
    // so "nearest earlier" would compare 2024-02 against 2023-12, across both a gap
    // and the year-to-date reset, and the banner would name a month that is not the
    // previous one.
    const prior = priorMonth(period);
    if (prior && totals.get(`${stream}|${prior}`)?.cum === t.cum)
      out.push({ stream, period, prior, cumulativeEur: t.cum });
  }
  return out.sort((a, b) =>
    `${a.stream}|${a.period}`.localeCompare(`${b.stream}|${b.period}`),
  );
};

/**
 * What this load CHANGES about rows the table already held.
 *
 * ⚠️ This exists because `recordIngestBatch` cannot see a correction. Its natural
 * key is `(reg_no, period)`, so a TRUNCATE+reload of months that are already in
 * `ingest_first_seen` itemises nothing — the rows are not new. That is right for an
 * ordinary reload and wrong for the case that matters: when a parser fix RESTATES
 * published money, `/data/updates` shows silence. Eleven months and €1,672,123
 * moved that way in the Tier 1 work (docs/plans/nzok-hospital-parser-hardening-v1.md
 * §9-2), including a sign flip on a named Sofia clinic, and nothing would have said so.
 *
 * Diffing the previous vintage inside the load's own transaction makes the
 * correction a MEASURED fact the operator can put in `data-changes.json`, rather
 * than a number somebody has to remember to write down. It also catches the next
 * one, which is the half that keeps working after this plan is forgotten.
 */
/** The identity of one published figure. Written ONCE and used on both sides of
 *  the diff — it was a SQL expression and a template literal, and a drift between
 *  them reports every row as added+removed and no row as restated, i.e. exactly the
 *  silence this diff exists to break. */
export const rowKey = (r: {
  reg_no: string;
  period: string;
  stream: string;
}): string => `${r.reg_no}|${r.period}|${r.stream}`;

export const diffAgainstPrevious = (
  previous: {
    reg_no: string;
    period: string;
    stream: string;
    cumulative_eur: number;
    month_eur: number;
  }[],
  incoming: Row[],
): {
  restatedRows: number;
  /** Of `restatedRows`, those whose CUMULATIVE did not move — a month figure
   *  changed and nothing else. Sized €0 by construction, so a euro total alone
   *  reports them as nothing: 33 of the Tier 1 corrections are exactly this shape
   *  (a fabricated month fragment replaced by 0, "unknown"). Counted separately so
   *  the changelog entry can say so instead of implying no row moved. */
  restatedMonthOnly: number;
  restatedEur: number;
  addedRows: number;
  removedRows: number;
} => {
  const before = new Map(previous.map((r) => [rowKey(r), r]));
  const seen = new Set<string>();
  let restatedRows = 0;
  let restatedMonthOnly = 0;
  let restatedEur = 0;
  let addedRows = 0;
  for (const r of incoming) {
    const key = rowKey(r);
    seen.add(key);
    const was = before.get(key);
    if (!was) {
      addedRows++;
      continue;
    }
    // A restatement is a row that existed and now says something different. The
    // € figure is the ABSOLUTE movement of the cumulative — a sign flip from
    // −€5,205 to +€5,205 is €10,410 of restated money, which is what a reader
    // comparing the two vintages would see.
    if (
      was.cumulative_eur !== r.cumulative_eur ||
      was.month_eur !== r.month_eur
    ) {
      restatedRows++;
      if (was.cumulative_eur === r.cumulative_eur) restatedMonthOnly++;
      restatedEur += Math.abs(r.cumulative_eur - was.cumulative_eur);
    }
  }
  return {
    restatedRows,
    restatedMonthOnly,
    restatedEur,
    addedRows,
    removedRows: previous.filter((r) => !seen.has(rowKey(r))).length,
  };
};

const main = async (): Promise<void> => {
  await exec(readFileSync(SCHEMA_FILE, "utf8"));
  await exec(readFileSync(TRENDS_SCHEMA_FILE, "utf8"));
  // Last: 050 widens the PK the INSERT conflict-targets and supersedes the 045 +
  // 047 payload functions with their stream-aware / stream-pinned versions.
  await exec(readFileSync(STREAMS_SCHEMA_FILE, "utf8"));
  // 065 adds the ownership column + the byOwnership split (supersedes 050's fns).
  await exec(readFileSync(OWNERSHIP_SCHEMA_FILE, "utf8"));
  // 187 — the coverage table. Independent of the payments schema above; applied
  // before the load so a refusal recorded below has somewhere to go.
  await exec(readFileSync(COVERAGE_SCHEMA_FILE, "utf8"));

  // Unlike its nzok siblings this loader has no committed corpus file — it
  // re-derives the corpus from the nhif.bg listing pages every run (the PDF
  // cache under raw_data/nzok/ only spares the per-file downloads). That makes
  // it the one db:refresh step with a hard network dependency, so the chain
  // passes --tolerate-offline: an nhif.bg outage (or an offline machine) then
  // SKIPS the load before any write — schemas stay applied, the table keeps its
  // previous vintage intact — instead of aborting the whole `&&`-chain. A
  // standalone/skill run keeps today's throw, and a PARSE failure throws
  // everywhere: unreachable is the absent-input case, malformed is a defect.
  let collected: Awaited<ReturnType<typeof collectRows>>;
  try {
    collected = await collectRows();
  } catch (e) {
    if (
      e instanceof NhifNetworkError &&
      process.argv.includes("--tolerate-offline")
    ) {
      console.warn(
        `[nzok-hospital] nhif.bg unreachable (${e.message}) — --tolerate-offline set, ` +
          "skipping the load; nzok_hospital_payments keeps its previous contents.",
      );
      await end();
      return;
    }
    throw e;
  }
  const { rows, monthsOk, monthsSkipped, notVerified, coverage } = collected;
  if (rows.length === 0)
    throw new Error("no НЗОК hospital-payment rows collected");

  const N = COLS.length;
  const BATCH = 800; // 800 × 10 = 8k params (< 65535)
  const delta = await withClient(async (c) => {
    await c.query("BEGIN");
    // Read the previous vintage BEFORE replacing it — see `diffAgainstPrevious`.
    // Inside the transaction, so what is compared is exactly what is replaced.
    const { rows: prevRows } = await c.query<{
      reg_no: string;
      period: string;
      stream: string;
      cumulative_eur: number;
      month_eur: number;
    }>(
      // The columns, never a pre-joined key — `rowKey` is the single definition
      // and both sides must go through it. `period::text` is the `YYYY-MM-DD` the
      // incoming rows also carry.
      `SELECT reg_no, period::text AS period, stream, cumulative_eur, month_eur
         FROM nzok_hospital_payments`,
    );
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
    // ── Coverage, replaced wholesale in the same transaction as the payments.
    //
    // ⚠️ It MUST be the same transaction. Coverage is the claim "this is what the
    // payments table contains and what it is missing", so a window where the two
    // disagree is a window in which the site can state a falsehood about its own
    // completeness — and the payments write is a TRUNCATE, so that window would be
    // the whole load.
    await c.query("TRUNCATE nzok_payment_coverage");
    for (const cov of coverage)
      await c.query(
        `INSERT INTO nzok_payment_coverage
           (stream, period, status, header_facility_count, header_total_eur,
            rows_loaded, rows_total_eur, reason, count_mismatch_blocks,
            count_mismatch_ordinals, unreconciled_blocks, unreconciled_eur,
            republishes_period)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          cov.stream,
          cov.period,
          cov.status,
          cov.header_facility_count,
          cov.header_total_eur,
          cov.rows_loaded,
          cov.rows_total_eur,
          cov.reason,
          cov.count_mismatch_blocks,
          cov.count_mismatch_ordinals,
          cov.unreconciled_blocks,
          cov.unreconciled_eur,
          cov.republishes_period,
        ],
      );
    // ── The two must agree, in BOTH directions and per month.
    //
    // Coverage is the claim "this is what the payments table contains and what it
    // is missing", so a disagreement is the table stating a falsehood about its own
    // completeness. Checked three ways, because each is a different lie:
    //   · a `loaded` month with no rows          — claims a month we do not have;
    //   · rows with no coverage row              — a month present and unaccounted,
    //                                              which is the original silence;
    //   · a row COUNT that differs               — the coverage figure a surface
    //                                              would quote is not the corpus.
    // The months are NAMED: a bare count sends the next reader back to the corpus
    // to work out which, and this fires inside a transaction that is about to roll
    // back, so the message is all they get.
    const { rows: disagree } = await c.query<{ kind: string; detail: string }>(
      `SELECT 'coverage says loaded, corpus has no rows' AS kind,
              c.stream || ' ' || c.period::text AS detail
         FROM nzok_payment_coverage c
        WHERE c.status = 'loaded'
          AND NOT EXISTS (SELECT 1 FROM nzok_hospital_payments p
                           WHERE p.stream = c.stream AND p.period = c.period)
        UNION ALL
       SELECT 'corpus has rows, coverage has no row',
              p.stream || ' ' || p.period::text
         FROM (SELECT DISTINCT stream, period FROM nzok_hospital_payments) p
        WHERE NOT EXISTS (SELECT 1 FROM nzok_payment_coverage c
                           WHERE c.stream = p.stream AND c.period = p.period)
        UNION ALL
       SELECT 'row count differs',
              c.stream || ' ' || c.period::text || ': coverage ' || c.rows_loaded
                || ' vs corpus ' || count(p.*)
         FROM nzok_payment_coverage c
         JOIN nzok_hospital_payments p
           ON p.stream = c.stream AND p.period = c.period
        WHERE c.status = 'loaded'
        GROUP BY c.stream, c.period, c.rows_loaded
       HAVING count(p.*) <> c.rows_loaded`,
    );
    if (disagree.length)
      throw new Error(
        `coverage disagrees with the corpus:\n` +
          disagree.map((d) => `  ${d.kind}: ${d.detail}`).join("\n"),
      );

    const d = diffAgainstPrevious(prevRows, rows);
    await c.query("COMMIT");
    return d;
  });

  // ⚠️ AFTER the COMMIT, never inside it — VACUUM cannot run in a transaction
  // block. Both tables are TRUNCATE + INSERT inside ONE transaction, which is the
  // shape that leaves `relallvisible = 0` PERMANENTLY: TRUNCATE mints a new
  // relfilenode with an empty map, every page is then written by a transaction
  // that has not committed so nothing can be marked all-visible, and the
  // insert-threshold autovacuum that follows runs where a concurrent step can hold
  // back the xmin horizon — it marks nothing, resets `n_ins_since_vacuum`, and with
  // `n_dead_tup` also 0 never revisits.
  //
  // This loader had no such call until 2026-08-25, and it was invisible to
  // `reload_visibility_map.data.test.ts`: that gate derives its file list by
  // globbing the loaders for `vacuumAfterReload` call sites, so a loader that
  // vacuums NOTHING contributes no names and is never checked. Locally it looked
  // healthy (456/456 pages) purely because autovacuum happened to reach it —
  // `last_vacuum` was null and `last_autovacuum` was not — which is timing, not a
  // guarantee, and Cloud SQL serves traffic continuously.
  await vacuumAfterReload("nzok_hospital_payments", "nzok_payment_coverage");

  const months = new Set(rows.map((r) => r.period)).size;
  const matched = rows.filter((r) => r.eik).length;

  console.log(
    `Loaded ${rows.length} rows · ${months} periods · ${monthsOk} months OK · ${matched} rows w/ eik (${((100 * matched) / rows.length).toFixed(0)}%)`,
  );
  if (monthsSkipped.length) {
    // ⚠️ NOT "parser hardening TODO" any more, which is what this said while 24 of
    // 127 files were withheld and the banner read as a standing chore. Since the
    // Tier 2 completeness work (docs/plans/nzok-hospital-parser-hardening-v1.md)
    // the expected count here is ZERO, so anything printed is a month the site is
    // MISSING and a regression to investigate — not a backlog item.
    console.log(
      `⚠️ Skipped ${monthsSkipped.length} month(s) — these are ABSENT from ` +
        `nzok_hospital_payments. Expected 0; each line is a file whose ` +
        `completeness assert fired:`,
    );

    monthsSkipped.forEach((m) => console.log(`  - ${m}`));
  }

  // ⚠️ A RESTATEMENT is not a new row and `/data/updates` cannot see it — see
  // `diffAgainstPrevious`.
  //
  // ⚠️⚠️ AND THE SIGNAL IS ONE-SHOT. Once this load commits, the corrected figures
  // ARE the previous vintage, so the next run reports nothing — the window is open
  // for exactly one execution and then closes permanently. That matters because
  // this loader runs UNATTENDED: `db:refresh` invokes it with `--tolerate-offline`,
  // so the run that consumes a €1.67M correction may be one nobody is watching, and
  // a message printed to a console nobody reads is the same as no message.
  //
  // So it writes the entry ITSELF rather than printing a command for a human to
  // run — the `update-prices` pattern, `dedupeSameDay` so a same-day re-run (or the
  // orchestrator's generic gate, which fires because this write flips
  // `git diff data/`) replaces rather than duplicates. `data/data-changes.json` is
  // git-tracked AND bucket-served, so it still has to be committed and synced; the
  // banner says so.
  //
  // Deliberately NOT `dedupeKey` (which `update-prices` uses): a restatement has
  // no stable payload identity to key on — the row set differs per database, so
  // the cloud run's delta against the CLOUD previous vintage need not match the
  // local one — and the signal being ONE-SHOT means a later, genuinely different
  // restatement must not collapse into an earlier one. What used to double-report
  // here is the `:cloud` twin (`db:load:nzok-hospital:pg:cloud` is this same
  // loader re-run against Cloud SQL, which sees the same restatements); that is
  // handled centrally now — appendDataChange suppresses any append made while
  // pointed at the serving database.
  if (delta.restatedRows > 0) {
    const eur = Math.round(delta.restatedEur).toLocaleString("en-US");
    const valueOnly = delta.restatedRows - delta.restatedMonthOnly;
    const summary =
      `НЗОК hospital payments restated: ${delta.restatedRows} row(s) changed value ` +
      `(${valueOnly} in the cumulative, €${eur}; ${delta.restatedMonthOnly} in the ` +
      `month only), ${delta.addedRows} added, ${delta.removedRows} removed`;
    appendDataChange({
      skill: "update-nzok",
      summary,
      source: "НЗОК болнични плащания (БМП/ЛП/МИ)",
      dedupeSameDay: true,
    });
    console.log(
      `⚠️ ${delta.restatedRows} row(s) RESTATED — money already published has ` +
        `changed value, and ingest_first_seen cannot itemise it (the rows are not ` +
        `new). Wrote data/data-changes.json:\n    ${summary}\n` +
        `    COMMIT it and include it in the bucket sync, or the corrected figures ` +
        `publish while the note explaining them does not:\n` +
        `      npm run bucket:sync:paths -- budget data-changes.json`,
    );
  } else if (delta.addedRows || delta.removedRows)
    console.log(
      `   ${delta.addedRows} row(s) added, ${delta.removedRows} removed; no ` +
        `published figure changed value.`,
    );

  // §9-3 — what loaded but could not be fully verified.
  //
  // REPORTED, never thrown: НЗОК's printed facility count means four different
  // things across this corpus, so no rule separates its bookkeeping from a real
  // drop by counting. What makes that safe is the Рег.№ universe assert in the
  // parser — every facility the document prints must reach a row — which throws.
  //
  // ⚠️ ONE LINE, not a per-month list. The count is stable at ~14 months and does
  // not clear, so an itemised ⚠️ block on every load is a standing banner nobody
  // reads — the exact shape this plan opens by blaming ("Skipped 25 months (parser
  // hardening TODO)"). What matters here is the TREND, so print the totals against
  // the measured baseline and let a DIFFERENCE be the thing that draws the eye.
  if (notVerified.length) {
    const blocks = notVerified.reduce((n, m) => n + m.countMismatchBlocks, 0);
    const ords = notVerified.reduce(
      (n, m) => n + m.missingOrdinals + m.extraOrdinals,
      0,
    );
    const unrec = notVerified.filter((m) => m.unreconciledBlocks);
    const unrecEur = unrec.reduce((n, m) => n + m.unreconciledEur, 0);
    // Measured 2026-08-25 over the cached corpus. A figure ABOVE this means НЗОК's
    // documents changed shape; the corpus gate is what actually fails on it
    // (hospital_payments_corpus.test.ts, keyed on (stream, block)).
    // Measured 2026-08-25 under this loader's own dedup semantics (127 distinct
    // (stream, period) pairs). `ordinals` counts absent AND extra: bmp 2026-06's
    // Русе prints 7 and numbers an 8th, so a missing-only figure would report that
    // block as disagreeing about nothing.
    const BASELINE = { months: 14, blocks: 27, ordinals: 143 };
    const same =
      notVerified.length === BASELINE.months &&
      blocks === BASELINE.blocks &&
      ords === BASELINE.ordinals;
    console.log(
      `   count model: ${notVerified.length} month(s) / ${blocks} block(s) / ` +
        `${ords} ordinal(s) disagree with НЗОК's own printed counts` +
        (same
          ? " — unchanged from baseline."
          : ` — BASELINE IS ${BASELINE.months}/${BASELINE.blocks}/${BASELINE.ordinals}; ` +
            `a rise means the documents changed shape. Run \`npm run test:unit -- scripts/nzok\`.`),
    );
    if (unrec.length)
      console.log(
        `   ⚠️ ${unrec.length} month(s) contain block(s) that print NO subtotal — ` +
          `€${Math.round(unrecEur).toLocaleString("en-US")} is NOT block-reconciled ` +
          `and rests on the whole-file 0.5% ratio, the check that let €1,672,123 ` +
          `through before this work: ` +
          unrec.map((m) => `${m.stream} ${m.period.slice(0, 7)}`).join(", "),
      );
  }

  // RC-5 — published as filed, and named. See `republishedMonths` for why.
  const republished = republishedMonths(rows);
  if (republished.length) {
    console.log(
      `⚠️ ${republished.length} month(s) repeat the immediately preceding month's ` +
        `year-to-date, with EVERY facility's month column at zero. PUBLISHED as ` +
        `НЗОК filed them — the figures are the source's, not a parse artifact — ` +
        `but a reader comparing the two months sees no payments at all in the later:`,
    );
    republished.forEach((r) =>
      console.log(
        `  - ${r.stream} ${r.period.slice(0, 7)} repeats ${r.prior.slice(0, 7)} ` +
          `(€${Math.round(r.cumulativeEur).toLocaleString("en-US")} YTD, €0 for the month)`,
      ),
    );
  }
  await end();
};

// Run only when invoked as the script, so the pure helpers above can be imported
// and tested. Same guard as `load_open_calls_pg.ts`; without it a test import runs
// the whole load, which is why this loader had no tests.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(async (e) => {
    console.error(e);
    await end();
    process.exit(1);
  });
}
