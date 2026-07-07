// Parser for НЗОК's monthly per-hospital БМП (болнична медицинска помощ) payment
// reports — "Заплатени здравноосигурителни плащания за БМП по лечебни заведения"
// published as an Excel-exported PDF at nhif.bg/bg/hospitals/bmp/{year}. One file
// per month, ~381 facilities, born-digital (Excel→PDF) so `pdftotext -layout`
// yields clean column-aligned rows — no OCR.
//
// Row shape (layout mode):
//   01   Благоевград   3   0103211001   МБАЛ Благоевград АД   4 684 771   903 437
//   └РЗОК┘ └РЗОК name┘ └ord┘ └Рег.№ ЛЗ┘ └── facility name ──┘ └ YTD € ┘ └month €┘
//
// The two trailing amounts are CUMULATIVE year-to-date and IN-MONTH; we keep both
// but the YTD is the headline (summing months would double-count). Amounts use a
// space thousands-separator. From 2026 the figures are in EUR (the header says
// "(в евро)"); earlier years are in BGN and get converted at the fixed rate.
//
// The file opens with a grand-total row ("381  Общо РЗОК  942 127 532  …") and a
// per-РЗОК subtotal row before each region's facilities — we use the grand total
// as a completeness assert (Σ facility YTD must reconcile to it) and skip the
// subtotals from the facility list.

import { spawnSync } from "child_process";
import { toEur } from "../../src/lib/currency";

export interface HospitalPaymentRow {
  /** 2-digit РЗОК (regional health fund) code, e.g. "01". */
  rzokCode: string;
  rzokName: string;
  /** 10-digit facility registration number (Рег.№ ЛЗ) — the join key to the
   *  ИАМН facility register (→ EIK). NOT an EIK itself. */
  regNo: string;
  name: string;
  /** Cumulative year-to-date paid, in euros. */
  cumulativeEur: number;
  /** Paid in the report month, in euros. */
  monthEur: number;
}

export interface HospitalPaymentsFile {
  /** ISO end-of-period date the report is "към", e.g. "2026-05-31". */
  asOf: string;
  year: number;
  month: number;
  currencyOfRecord: "BGN" | "EUR";
  /** Grand total from the "Общо РЗОК" header row (YTD), in euros. */
  totalCumulativeEur: number;
  facilityCount: number;
  rows: HospitalPaymentRow[];
}

const num = (s: string): number => {
  const n = Number(s.replace(/\s/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

/** Parse the "…към DD.MM.YYYY…" period from the title into an ISO date. */
const parseAsOf = (
  txt: string,
): { year: number; month: number; iso: string } => {
  const m = txt.match(/към\s+(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) throw new Error("could not find 'към DD.MM.YYYY' period in the PDF");
  const [, d, mo, y] = m;
  const year = Number(y);
  const month = Number(mo);
  const iso = `${y}-${String(month).padStart(2, "0")}-${String(Number(d)).padStart(2, "0")}`;
  return { year, month, iso };
};

// A space-grouped Bulgarian amount ("4 684 771", "903 437") or a bare integer.
// Used to pull the trailing two amounts (cumulative YTD, then in-month) off a
// row's accumulated text. The thousands-separator class is space, tab or NBSP —
// non-newline space — deliberately: when a very long facility name wraps, a
// stray name-fragment digit can sit at the end of one physical line and the real
// amount start the next; joining rows with "\n" (below) then keeps them as two
// separate tokens instead of merging "48" + "230 716" into a bogus "48 230 716".
const AMOUNT_RE = /\d{1,3}(?:[ \t\u00a0]\d{3})+|\d+/g;

/** Pull the last two amounts from a row's accumulated tail (text after the reg
 *  number, possibly spanning wrapped lines). Returns them in document order
 *  (cumulative, month) and strips the amounts off the facility name. Digits
 *  inside the name (e.g. "ДКЦ 1") are harmless: the amounts are always the last
 *  two numbers on the row. */
const extractAmounts = (
  tail: string,
): { name: string; cumulative: number; month: number } | null => {
  const matches = [...tail.matchAll(AMOUNT_RE)];
  if (matches.length < 2) return null;
  const cumM = matches[matches.length - 2];
  const monM = matches[matches.length - 1];
  const cumulative = num(cumM[0]);
  const month = num(monM[0]);
  if (!Number.isFinite(cumulative) || !Number.isFinite(month)) return null;
  const name = tail
    .slice(0, cumM.index ?? 0)
    .replace(/\s+/g, " ")
    .replace(/[\s"„“]+$/u, "")
    .trim();
  if (!name) return null;
  return { name, cumulative, month };
};

// A facility row start: 2-digit РЗОК code, region name (no digits), ordinal,
// 10-digit Рег.№ ЛЗ, then the rest (name + amounts, which may wrap to the next
// line). Region subtotals ("13  РЗОК Благоевград  …") and the grand total
// ("381  Общо РЗОК  …") have no 10-digit reg number, so they never match.
const ROW_START_RE = /^\s*(\d{2})\s+(\S[^\d]*?)\s+\d+\s+(\d{10})\b(.*)$/;
const BREAK_RE = /Общо\s+РЗОК|^\s*\d+\s+РЗОК\s+\S/;

export const parseHospitalPaymentsPdf = (
  pdfPath: string,
): HospitalPaymentsFile => {
  const res = spawnSync("pdftotext", ["-layout", pdfPath, "-"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0 || !res.stdout)
    throw new Error(`pdftotext failed for ${pdfPath}: ${res.stderr ?? ""}`);
  const text = res.stdout;
  const { year, month, iso } = parseAsOf(text);
  const currency: "BGN" | "EUR" = /\(в\s*евро\)/i.test(text) ? "EUR" : "BGN";
  const asEur = (v: number): number =>
    currency === "EUR" ? v : Math.round(toEur(v, "BGN") ?? 0);

  const lines = text.split(/\r?\n/);
  const rows: HospitalPaymentRow[] = [];
  let totalCumulativeEur = 0;
  let headerFacilityCount = 0;

  // Grand total: a row whose label is "Общо РЗОК" with two trailing amounts and
  // a leading facility count (e.g. "381   Общо РЗОК   942 127 532   191 249 510").
  const totalLine = lines.find((l) => /Общо\s+РЗОК/.test(l));
  if (totalLine) {
    const m = totalLine.match(
      /(\d+)\s+Общо\s+РЗОК\s+([\d\s]+?)\s{2,}([\d\s]+?)\s*$/,
    );
    if (m) {
      headerFacilityCount = Number(m[1]);
      totalCumulativeEur = asEur(num(m[2]));
    }
  }

  // Accumulate logical rows: a row starts at a ROW_START_RE line and absorbs any
  // following continuation lines (a wrapped long name / an amount pushed to the
  // next line) until the next row start, a subtotal/total, or a blank line. Then
  // the trailing two numbers of the accumulated text are the amounts.
  let pending: {
    rzokCode: string;
    rzokName: string;
    regNo: string;
    tail: string;
  } | null = null;
  const flush = () => {
    if (!pending) return;
    const parsed = extractAmounts(pending.tail);
    if (parsed)
      rows.push({
        rzokCode: pending.rzokCode,
        rzokName: pending.rzokName,
        regNo: pending.regNo,
        name: parsed.name,
        cumulativeEur: asEur(parsed.cumulative),
        monthEur: asEur(parsed.month),
      });
    pending = null;
  };

  for (const line of lines) {
    const start = line.match(ROW_START_RE);
    if (start) {
      flush();
      const [, rzokCode, rzokNameRaw, regNo, rest] = start;
      pending = { rzokCode, rzokName: rzokNameRaw.trim(), regNo, tail: rest };
      continue;
    }
    if (BREAK_RE.test(line) || line.trim() === "") {
      flush();
      continue;
    }
    // Continuation of the current row's wrapped name / amount. Joined with "\n"
    // (not a space) so a name-fragment digit ending one line can't merge with an
    // amount group starting the next (see AMOUNT_RE).
    if (pending) pending.tail += "\n" + line;
  }
  flush();

  // Completeness assert — Σ facility YTD must reconcile to the header grand
  // total within a small rounding tolerance (the euro conversion + the
  // per-facility rounding). A large drift means the parser dropped rows.
  if (totalCumulativeEur > 0) {
    const sum = rows.reduce((s, r) => s + r.cumulativeEur, 0);
    const drift = Math.abs(sum - totalCumulativeEur) / totalCumulativeEur;
    if (drift > 0.005)
      throw new Error(
        `reconciliation failed for ${pdfPath}: Σ facilities €${sum} vs header €${totalCumulativeEur} (drift ${(drift * 100).toFixed(2)}%, ${rows.length} rows parsed vs ${headerFacilityCount} expected)`,
      );
  }
  if (headerFacilityCount && Math.abs(rows.length - headerFacilityCount) > 2)
    throw new Error(
      `facility-count mismatch for ${pdfPath}: parsed ${rows.length}, header says ${headerFacilityCount}`,
    );

  return {
    asOf: iso,
    year,
    month,
    currencyOfRecord: currency,
    totalCumulativeEur,
    facilityCount: rows.length,
    rows,
  };
};
