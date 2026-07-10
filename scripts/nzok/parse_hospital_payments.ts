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

// Same, but keeping a leading minus. The \u041b\u041f / \u041c\u0418 reports carry NEGATIVE figures
// (a reversal or a clawback nets a facility's month, and occasionally its YTD,
// below zero) which the \u0411\u041c\u041f report never does. Only used in lenient mode: a bare
// `-?` in the \u0411\u041c\u041f path would let a hyphen inside a facility name ("\u041a\u041e\u0426 - \u0411\u0443\u0440\u0433\u0430\u0441")
// swallow the following digit. Here the minus must sit immediately before a digit,
// so "- \u0411\u0443\u0440\u0433\u0430\u0441" cannot match while "-4 680" does.
const SIGNED_AMOUNT_RE = /-?\d{1,3}(?:[ \t\u00a0]\d{3})+|-?\d+/g;

/**
 * Which of the three monthly per-hospital reports a file is. \u041d\u0417\u041e\u041a publishes them
 * side by side on the same `bmp/{year}` listing page, one per money stream, and a
 * hospital's total \u041d\u0417\u041e\u041a income is the sum of all three. Parsing only `bmp` \u2014 as
 * this module did originally \u2014 understates every facility.
 *
 *   bmp      "\u0417\u0430\u043f\u043b\u0430\u0442\u0435\u043d\u0438 \u0437\u0434\u0440\u0430\u0432\u043d\u043e\u043e\u0441\u0438\u0433\u0443\u0440\u0438\u0442\u0435\u043b\u043d\u0438 \u043f\u043b\u0430\u0449\u0430\u043d\u0438\u044f \u0437\u0430 \u0411\u041c\u041f \u043f\u043e \u041b\u0417"
 *   drugs    "\u0417\u0430\u043f\u043b\u0430\u0442\u0435\u043d\u0438 \u0441\u0440\u0435\u0434\u0441\u0442\u0432\u0430 \u0437\u0430 \u041b\u041f \u0432 \u0443\u0441\u043b\u043e\u0432\u0438\u044f\u0442\u0430 \u043d\u0430 \u0411\u041c\u041f \u043f\u043e \u041b\u0417"   (\u043b\u0435\u043a\u0430\u0440\u0441\u0442\u0432\u0435\u043d\u0438 \u043f\u0440\u043e\u0434\u0443\u043a\u0442\u0438)
 *   devices  "\u0417\u0430\u043f\u043b\u0430\u0442\u0435\u043d\u0438 \u0441\u0440\u0435\u0434\u0441\u0442\u0432\u0430 \u0437\u0430 \u041c\u0418 \u043f\u0440\u0438\u043b\u0430\u0433\u0430\u043d\u0438 \u0432 \u0411\u041c\u041f \u043f\u043e \u041b\u0417"      (\u043c\u0435\u0434\u0438\u0446\u0438\u043d\u0441\u043a\u0438 \u0438\u0437\u0434\u0435\u043b\u0438\u044f)
 */
export type PaymentStream = "bmp" | "drugs" | "devices";

/**
 * The `drugs` / `devices` reports differ from `bmp` in three ways that would
 * otherwise silently drop rows:
 *
 *  1. Their grand total is labelled "\u041e\u0411\u0429\u041e", not "\u041e\u0431\u0449\u043e \u0420\u0417\u041e\u041a".
 *  2. A facility may report a single amount \u2014 the month column is left blank when
 *     nothing moved that month \u2014 so the two-amount minimum drops the row.
 *  3. Amounts can be negative.
 *
 * `bmp` keeps the strict reading, unchanged, so the shipped corpus and
 * parse_hospital_payments.test.ts stay byte-identical.
 */
const isLenient = (s: PaymentStream): boolean => s !== "bmp";

// In the `devices` report a facility's glyph boxes can overlap the amount column,
// and `pdftotext -layout` then drops the amount's LEADING thousands group inside
// the name:
//
//   layout: "… УМБАЛ ТОКУДА6EАД        735 587    0"
//   raw:    "… УМБАЛ ТОКУДА EАД  6 735 587  0"      ← the truth
//
// `-raw` has the right reading but collapses the two amount columns into one
// ambiguous run ("1 562 275 488 147 886 902"), so it cannot replace `-layout`.
// Instead we move a digit run that sits GLUED BETWEEN TWO LETTERS back onto the
// front of the row's next amount. The pattern requires letters on both sides with
// no space, so a legitimate name numeral ("МБАЛ 2", "149 СУ") can never match —
// verified zero hits across the `bmp` and `drugs` reports. Any mistake here is
// caught by the whole-file reconciliation assert below, which is why the repair
// is safe to apply unconditionally on the lenient streams.
const repairGluedThousands = (tail: string): string =>
  tail.replace(
    /(\p{L})(\d{1,3})(\p{L}+)(\s+)(\d{1,3}(?:[ \t ]\d{3})+|\d+)/u,
    "$1$3$4$2 $5",
  );

/** Pull the amounts off a row's accumulated tail (text after the reg number,
 *  possibly spanning wrapped lines).
 *
 *  The cumulative YTD is the LARGEST money figure in a row — it is ≥ its own
 *  reporting month, and ≥ any name-embedded index digit ("МБАЛ 2"). So we take
 *  two candidate readings and keep the larger; its position bounds the facility
 *  name. This one rule unifies every observed layout without per-case branching:
 *   - Candidate A — first amount AFTER the last name letter. Right for the
 *     early-year 3-column merge (two month columns share one gutter) and a name
 *     glued to the first amount with no gutter ("…ЕООД242 730", "гр. Монтана 694 602").
 *   - Candidate B — the second-to-last amount of the whole row. Right for wrapped
 *     rows where a name fragment trails the amounts (so "after the last letter"
 *     lands on a fragment, not the cumulative).
 *  A merged/again-wrapped month reads > cumulative and is recorded 0 (unknown)
 *  rather than a wrong figure. */
export const extractAmounts = (
  tail: string,
  stream: PaymentStream = "bmp",
): { name: string; cumulative: number; month: number } | null => {
  const lenient = isLenient(stream);
  const re = () => new RegExp(lenient ? SIGNED_AMOUNT_RE : AMOUNT_RE);
  const all = [...tail.matchAll(re())];
  // `bmp` always prints both columns. `drugs`/`devices` leave the month blank
  // when nothing moved, so one amount is a complete row there, not a dropped one.
  if (all.length < (lenient ? 1 : 2)) return null;

  let cumulative: number;
  let cumIdx: number;
  let month: number;

  if (all.length === 1) {
    // Lenient-only: cumulative with no month column.
    cumulative = num(all[0][0]);
    cumIdx = all[0].index ?? -1;
    month = 0;
  } else {
    // Candidate A — first amount after the last letter.
    let lastLetter = -1;
    for (const m of tail.matchAll(/\p{L}/gu))
      lastLetter = m.index ?? lastLetter;
    const region = lastLetter >= 0 ? tail.slice(lastLetter + 1) : "";
    const rm = [...region.matchAll(re())];
    const aVal = rm.length ? num(rm[0][0]) : NaN;
    const aIdx = rm.length ? lastLetter + 1 + (rm[0].index ?? 0) : -1;

    // Candidate B — second-to-last amount of the whole row.
    const bVal = num(all[all.length - 2][0]);
    const bIdx = all[all.length - 2].index ?? -1;

    const useA =
      Number.isFinite(aVal) && (!Number.isFinite(bVal) || aVal >= bVal);
    cumulative = useA ? aVal : bVal;
    cumIdx = useA ? aIdx : bIdx;

    // Reporting month — the amount right after the cumulative (in A's region, or
    // the row's last amount for B). Zeroed when it reads larger than cumulative
    // (a merged/wrapped month), so a wrong figure is never recorded. A negative
    // month is legitimate in the lenient streams and must survive the check.
    month = useA
      ? rm.length >= 2
        ? num(rm[1][0])
        : NaN
      : num(all[all.length - 1][0]);
    if (!Number.isFinite(month) || month > cumulative) month = 0;
  }

  // Keep zero-payment facilities (cumulative 0) — they're counted in the facility
  // total and contribute 0 to the sum; only a non-finite reading is a genuine
  // drop. A negative cumulative is real in `drugs`/`devices` (a net clawback) and
  // impossible in `bmp`, where it still means a misparse.
  if (!Number.isFinite(cumulative)) return null;
  if (!lenient && cumulative < 0) return null;

  const name = tail
    .slice(0, cumIdx >= 0 ? cumIdx : (all[0].index ?? 0))
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
// `bmp` labels its grand total "Общо РЗОК"; `drugs`/`devices` label theirs
// "ОБЩО" (all-caps, no "РЗОК"). Both are followed by the per-РЗОК subtotals,
// which carry no 10-digit reg number and so can never match ROW_START_RE.
//
// The right boundary is `(?!\p{L})` with the `u` flag, NEVER `\b`: JavaScript's
// `\b` is ASCII-only, so it does not fire after a Cyrillic letter — `/ОБЩО\b/`
// silently matches nothing, the grand total reads 0, and the reconciliation
// assert below turns itself off. Same footgun as lib/bmp_links.ts.
const BREAK_RE = /Общо\s+РЗОК|^\s*\d+\s+ОБЩО(?!\p{L})|^\s*\d+\s+РЗОК\s+\S/u;
const TOTAL_RE = /(\d+)\s+(?:Общо\s+РЗОК|ОБЩО)(?!\p{L})/u;

export const parseHospitalPaymentsPdf = (
  pdfPath: string,
  stream: PaymentStream = "bmp",
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

  // Grand total, e.g. "381  Общо РЗОК  942 127 532  191 249 510" (2 columns) or
  // "380  Общо РЗОК  368 752 383  182 964 878  185 787 505" (3). Facility count
  // leads; cumulative is the FIRST amount after the label (the wide-gutter one),
  // even when the trailing month columns merge under a single space.
  const totalLine = lines.find((l) => TOTAL_RE.test(l));
  if (totalLine) {
    const cnt = totalLine.match(TOTAL_RE);
    if (cnt) headerFacilityCount = Number(cnt[1]);
    const after = totalLine.replace(/^.*?(?:Общо\s+РЗОК|ОБЩО)/, "");
    const amts = [
      ...after.matchAll(isLenient(stream) ? SIGNED_AMOUNT_RE : AMOUNT_RE),
    ].map((mm) => num(mm[0]));
    if (amts.length >= 1) totalCumulativeEur = asEur(amts[0]);
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
    const tail = isLenient(stream)
      ? repairGluedThousands(pending.tail)
      : pending.tail;
    const parsed = extractAmounts(tail, stream);
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
  if (Math.abs(totalCumulativeEur) > 0) {
    const sum = rows.reduce((s, r) => s + r.cumulativeEur, 0);
    const drift =
      Math.abs(sum - totalCumulativeEur) / Math.abs(totalCumulativeEur);
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
