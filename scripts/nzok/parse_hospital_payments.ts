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
  /** Cumulative year-to-date paid, in euros. NEGATIVE when the period nets to a
   *  clawback — real on ALL THREE streams since 2026-08-24; see SIGNED_AMOUNT_RE. */
  cumulativeEur: number;
  /** Paid in the report month, in euros. Negative on a reversal, as above. */
  monthEur: number;
}

export interface HospitalPaymentsFile {
  /** ISO end-of-period date the report is "към", e.g. "2026-05-31". */
  asOf: string;
  year: number;
  month: number;
  currencyOfRecord: "BGN" | "EUR";
  /** Grand total from the "Общо РЗОК" header row (YTD), in euros. May be negative
   *  in principle (both downstream guards take `Math.abs`); never is in practice. */
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

// A space-grouped Bulgarian amount ("4 684 771", "903 437", "-10 180") or a bare
// integer. Used to pull the trailing two amounts (cumulative YTD, then in-month)
// off a row's accumulated text.
//
// The thousands-separator class is space, tab or NBSP — non-newline space —
// deliberately: when a very long facility name wraps, a stray name-fragment digit
// can sit at the end of one physical line and the real amount start the next;
// joining rows with "\n" (below) then keeps them as two separate tokens instead of
// merging "48" + "230 716" into a bogus "48 230 716".
//
// ⚠️ IT IS SIGNED ON EVERY STREAM, and until 2026-08-24 it was not. This file's
// stated premise was that the ЛП / МИ reports carry negatives "which the БМП
// report never does". That is FALSE: НЗОК files a clawback in БМП too, and the
// unsigned reader published the reversal as INCOME against a named facility —
// „ДКЦ Св. София ЕООД  -10 180" read as +10,180 BGN for six consecutive months
// (2023-07..12, a €10,410 error each on the София-град block), with the minus
// swallowed into the NAME, so the stored name ended in " -" and that was the only
// visible trace. Measured over the cached corpus: 8 БМП files carry a negative,
// 7 of them loaded. See docs/plans/nzok-hospital-parser-hardening-v1.md §3 RC-4.
//
// A minus is read as a SIGN only when it sits immediately before a digit AND does
// not immediately follow a letter or digit. Both halves are needed and the second
// is not cosmetic: `pdftotext -layout` welds an amount onto the end of a name when
// the glyph boxes overlap (RC-1 — "…ЕООД242 730", "…EАД376 725"), so a name ending
// in a hyphen would hand the amount a minus it does not have and publish a payment
// as a clawback — the exact failure this constant exists to end, mirrored. Measured
// on the current corpus: "МБАЛ Девин ЕООД-1 500 000" read −1,500,000 without the
// guard and +1,500,000 with it, while all 42 real negatives are preceded by
// whitespace and are unaffected.
//
// ⚠️ The lookbehind guards the MINUS, never the digits. Anchoring the whole token
// (`(?<![\p{L}\p{N}])-?\d…`) looks equivalent and is not: it also refuses a digit
// run welded to a name, so "…ЕООД242 730" reads as "730" and €242,730 vanishes —
// verified, and it is what the review of this change originally proposed.
//
// This makes the guard EMPIRICAL, not a proof. The residual is its mirror: a
// genuinely negative amount welded to a name ("…ЕООД-10 180") now reads positive.
// That is the better trade — negatives are 42 of 41,495 row tails — but it is a
// trade, and only reading the amounts from the header's COLUMN POSITIONS closes
// both (Tier 1 item 3 of the hardening plan).
/** The sign half of the amount grammar. Kept separate so the three regexes below
 *  cannot drift: they were three verbatim copies for one commit, and the comment
 *  above records what the LAST divergence cost (an unsigned copy that declined to
 *  repair a clawback, and a separator class that was a plain space written twice). */
const SIGN = String.raw`(?:(?<![\p{L}\p{N}])-)?`;
const AMOUNT_SRC = String.raw`${SIGN}\d{1,3}(?:[ \t\u00a0]\d{3})+|${SIGN}\d+`;

const SIGNED_AMOUNT_RE = new RegExp(AMOUNT_SRC, "gu");

/**
 * Which of the three monthly per-hospital reports a file is. НЗОК publishes them
 * side by side on the same `bmp/{year}` listing page, one per money stream, and a
 * hospital's total НЗОК income is the sum of all three. Parsing only `bmp` — as
 * this module did originally — understates every facility.
 *
 *   bmp      "Заплатени здравноосигурителни плащания за БМП по ЛЗ"
 *   drugs    "Заплатени средства за ЛП в условията на БМП по ЛЗ"   (лекарствени продукти)
 *   devices  "Заплатени средства за МИ прилагани в БМП по ЛЗ"      (медицински изделия)
 */
export type PaymentStream = "bmp" | "drugs" | "devices";

/**
 * The `drugs` / `devices` reports differ from `bmp` in two ways that would
 * otherwise silently drop rows:
 *
 *  1. Their grand total is labelled "ОБЩО", not "Общо РЗОК".
 *  2. A facility may report a single amount — the month column is left blank when
 *     nothing moved that month — so the two-amount minimum drops the row.
 *
 * ⚠️ "Amounts can be negative" used to be listed here as a THIRD difference and is
 * not one: every stream is read signed (see SIGNED_AMOUNT_RE). Leaving that claim
 * in place is how the same premise elsewhere in this file published a БМП clawback
 * as income for six months. What `bmp` still keeps is the strict two-amount
 * minimum and the merged-month clamp; the corpus and this file's test fixtures are
 * NOT byte-identical across that change — 42 rows moved, all of them sign fixes.
 */
const isLenient = (s: PaymentStream): boolean => s !== "bmp";

// In the `devices` report a facility's glyph boxes can overlap the amount column,
// and `pdftotext -layout` then drops the amount's LEADING thousands group inside
// the name:
//
//   layout: "… УМБАЛ ТОКУДА6EАД        735 587"
//   raw:    "… УМБАЛ ТОКУДА EАД  6 735 587"      ← the truth
//
// `-raw` has the right reading but collapses the two amount columns into one
// ambiguous run ("1 562 275 488 147 886 902"), so it cannot replace `-layout`.
// Instead we move the orphaned digit run back onto the front of the row's next
// amount.
//
// ⚠️ THE SPACING VARIES MONTH TO MONTH AND ONE PATTERN DOES NOT COVER IT. This
// was a single rule until 2026-08-24 and it silently missed 12 of the 40 affected
// files — every one of them the SAME row, Рег.№ 2201211067 (Аджибадем Сити Клиник
// УМБАЛ Токуда) — 35 files carry the glue, 12 of them in a spacing the single
// rule missed — each losing exactly one leading thousands group, i.e. a round
// million: €2,000,001 on devices 2026-07 alone. Four spacings occur:
//
//   ТОКУДА6EАД        735 587     welded both sides           → A
//   ТОКУДА 2EАД       953 094     space before the digit      → A
//   ТОКУДА 4      EАД376 725      digit free, letters glued
//                                 to the amount               → B
//   ТОКУДА 5     EАД⏎  245 651    digit free, amount wrapped  → B
//
// ⚠️ DO NOT "SIMPLIFY" THESE INTO ONE `\s*`-EVERYWHERE PATTERN. Allowing
// whitespace on BOTH sides of the digit run matches genuine facility names:
// measured, it newly touches „ДКЦ 1 Добрич" and „ДКЦ 2 Добрич" (0828134001 /
// 0828134002, 90 rows) and would move their „1"/„2" onto the amount — publishing
// two different Dobrich clinics under one name „ДКЦ Добрич". What separates the
// two cases is that the ТОКУДА digit is welded to something (the letters after
// it, in A; the amount, in B) while a real name digit is free on both sides and
// followed by an ordinary wide gutter.
//
// Any mistake here is caught by the whole-file reconciliation assert, which is
// why the repair is safe to apply unconditionally on the lenient streams — and
// measured over every cached row tail, A and B together add exactly the 12
// missing ТОКУДА rows and touch nothing else.

/** A — the digit run is welded to the letters that follow it, with at most one
 *  space in front of it. This is the shape the original single pattern covered,
 *  plus the one-space-before variant it did not.
 *
 *  ⚠️ NOT a strict superset of that pattern, and a draft of this comment claimed it
 *  was. The original gap was `(\s+)`, which includes a newline; this is
 *  `[ \t\u00a0]+`. So "digit welded to the fragment AND amount wrapped to the next
 *  line" is now covered by NEITHER rule — 0 occurrences today, and the ТОКУДА row
 *  exhibits each condition separately, so the conjunction is possible. It fails
 *  LOUDLY if it happens (a ~4% drift rejects the file) rather than publishing a
 *  wrong number, which is why it is left uncovered rather than guessed at. */
const GLUE_WELDED_TO_NAME = new RegExp(
  String.raw`(\p{L})[ \t\u00a0]?(\d{1,3})(\p{L}+)([ \t\u00a0]+)(${AMOUNT_SRC})`,
  "u",
);

/** B — the digit run stands free, and the name fragment after it is welded to the
 *  amount (or the amount wrapped to the next physical line).
 *
 *  ⚠️ B's regex CANNOT discriminate on its own, and the earlier comment here
 *  claimed it could. It requires the digit free on both sides — which is exactly
 *  what a real name digit („ДКЦ 1 Добрич") looks like — so the only structural
 *  difference left is how the month happened to render the separator after the
 *  fragment, and that is a property of `pdftotext`, not of the facility. Measured
 *  against the shipped function before the guards below existed:
 *
 *    "ДКЦ 2 Добрич⏎   905 100  40 000" → { name: "ДКЦ Добрич", cum: 2 905 100 }
 *
 *  — a fabricated €2,000,000 AND two different Dobrich clinics (0828134001 /
 *  0828134002) published under one name. The guards in `repairGluedThousands` are
 *  what make this rule safe; the regex is only half of it.
 *
 *  ⚠️ B collapses the whitespace it consumes, because for the wrapped variant the
 *  whole point is to move the digit ACROSS the newline to its amount. Tier 1 item 3
 *  of the hardening plan wants amounts read from the header's COLUMN POSITIONS, and
 *  this repair runs first — so the gutter it destroys is exactly the one those rows
 *  would need. Resolve that interaction there; it cannot be resolved here. */
const GLUE_ORPHANED_DIGIT = new RegExp(
  String.raw`(\p{L})[ \t\u00a0]+(\d{1,3})[ \t\u00a0]+(\p{L}+)(?:|\n[ \t]*)(${AMOUNT_SRC})`,
  "u",
);

/** A splice is only ever correct when the orphaned digit run is the amount's
 *  dropped LEADING thousands group — so re-joining the two must yield ONE
 *  well-formed grouped amount. „ДКЦ 1 Добрич  25 382" fails this in every
 *  rendering (`1 25 382` is not grouped), and so does a small amount that would
 *  otherwise strand a digit in the name („ТОКУДА6EАД 58" → `6 58`). */
const GROUPED_AMOUNT = /^-?\d{1,3}(?:[ \t\u00a0]\d{3})+$/u;

/** …and for rule B, which cannot discriminate structurally, the fragment must also
 *  be short. What a glue leaves behind is the tail of a legal form — every one
 *  observed across the cache is „EАД" — whereas a real free-standing name digit is
 *  followed by a word („Добрич", 6 letters). This is an EMPIRICAL bound, not a
 *  proof; the structural answer is the plan's block-driven repair (Tier 2), which
 *  attempts a splice only when the block fails to reconcile and keeps it only when
 *  the block then reconciles exactly. */
const MAX_GLUE_FRAGMENT = 4;

/** Exported for testing: this is the unit RC-1 lives in, and its four spacings
 *  are only visible at the string level — `extractAmounts` sees the repaired
 *  tail, so a test written against that cannot tell a repair from a no-op. */
export const repairGluedThousands = (tail: string): string =>
  tail
    .replace(
      GLUE_WELDED_TO_NAME,
      (
        m,
        lead: string,
        digits: string,
        frag: string,
        gap: string,
        amt: string,
      ) =>
        GROUPED_AMOUNT.test(`${digits} ${amt}`)
          ? `${lead} ${frag}${gap}${digits} ${amt}`
          : m,
    )
    .replace(
      GLUE_ORPHANED_DIGIT,
      (m, lead: string, digits: string, frag: string, amt: string) =>
        frag.length <= MAX_GLUE_FRAGMENT &&
        GROUPED_AMOUNT.test(`${digits} ${amt}`)
          ? `${lead} ${frag} ${digits} ${amt}`
          : m,
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
  // One reader, but still a factory: `matchAll` reads `lastIndex` off the source
  // regex, so every scan gets its own copy rather than sharing mutable state with
  // the module constant. Kept deliberately, not a leftover from the two-regex fork.
  const re = () => new RegExp(SIGNED_AMOUNT_RE);
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
    // (a merged/wrapped month), so a wrong figure is never recorded.
    month = useA
      ? rm.length >= 2
        ? num(rm[1][0])
        : NaN
      : num(all[all.length - 1][0]);
    // The `month > cumulative` guard is a heuristic for a MERGED month column:
    // a year-to-date figure cannot be smaller than its own month's flow, so a
    // month that reads larger means the column wrapped or merged, and 0
    // ("unknown") is recorded rather than a wrong figure.
    //
    // ⚠️ `cumulative >= 0` is the load-bearing clause and it has its own test:
    // `month > cumulative` is trivially true whenever the YTD is negative, so
    // without it a real positive month on a clawed-back facility is zeroed
    // (ДКЦ Св. София, −10 180 YTD against a +200 month, is such a row). A
    // `month >= 0` clause used to sit beside it and was provably unreachable —
    // given `cumulative >= 0` and `month > cumulative`, month is already > 0.
    //
    // ⚠️ It must not fire on a NEGATIVE figure, on any stream. Once a clawback is
    // readable, `month > cumulative` is true for a perfectly valid month closer to
    // zero (−50 > −100). It also stays БМП-only, and that is measured rather than
    // inherited: on the lenient streams a positive month legitimately exceeds a
    // YTD that an earlier clawback dragged down — devices 2023-02 is the whole
    // national file (month 5,385,156 BGN against a YTD of 5,381,471), and УМБАЛ
    // Александровска's real 47,073 BGN month sits inside it. Applying the clamp
    // there would zero a real figure on a named hospital, so the plan's
    // "make it lenient-independent" is deliberately NOT what ships here.
    if (
      !Number.isFinite(month) ||
      (!lenient && cumulative >= 0 && month > cumulative)
    )
      month = 0;
  }

  // Keep zero-payment facilities (cumulative 0) — they're counted in the facility
  // total and contribute 0 to the sum; only a non-finite reading is a genuine drop.
  //
  // A negative cumulative is REAL on every stream — a net clawback — and the
  // `!lenient && cumulative < 0 → null` rejection that used to sit here was the
  // second half of the false "БМП never carries negatives" premise. It never
  // actually fired, because the unsigned reader could not produce a negative in
  // the first place; had the sign been readable it would have DROPPED
  // „ДКЦ Св. София ЕООД -10 180" instead of inverting it. Dropping is the better
  // of the two failures and is still the wrong answer.
  if (!Number.isFinite(cumulative)) return null;

  const name = tail
    .slice(0, cumIdx >= 0 ? cumIdx : (all[0].index ?? 0))
    .replace(/\s+/g, " ")
    .replace(/[\s"„“]+$/u, "")
    .trim();
  if (!name) return null;
  return { name, cumulative, month };
};

// A facility row start: 2-digit РЗОК code, region name (no digits), an OPTIONAL
// ordinal, 10-digit Рег.№ ЛЗ, then the rest (name + amounts, which may wrap to
// the next line). Region subtotals ("13  РЗОК Благоевград  …") and the grand
// total ("381  Общо РЗОК  …") have no 10-digit reg number, so they never match.
//
// The ordinal is optional because НЗОК leaves "№ по ред" BLANK on some
// zero-payment facilities — they are listed but not numbered, since the counted
// universe is the facilities it actually paid. Requiring the ordinal did not
// merely skip those rows, it corrupted the row BEFORE each one: a line that
// fails ROW_START_RE is treated as a wrapped continuation, so the unnumbered
// facility was appended to its predecessor's tail, overwriting that row's name
// with the swallowed text and pushing a trailing "0 0" into the amount scan —
// zeroing a genuinely paid facility. 2026-06 listed 6 such rows, which landed in
// 5 hosts (one absorbed two) and dropped €1,008,597 — 0.09%, comfortably inside
// the Σ reconciliation tolerance, so ONLY the facility-count assert caught it.
// Making the ordinal optional is what keeps the two asserts independent.
//
// Whitespace separates the ordinal from the reg number and `\d{10}` needs ten
// CONTIGUOUS digits, so an ordinal can never be mistaken for one; the optional
// group is unambiguous in both directions.
const ROW_START_RE = /^\s*(\d{2})\s+(\S[^\d]*?)\s+(?:\d+\s+)?(\d{10})\b(.*)$/;
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

/**
 * Read the header grand-total line — the facility count and the FIRST amount after
 * the label — e.g. "381  Общо РЗОК  942 127 532  191 249 510" (2 columns) or
 * "380  Общо РЗОК  368 752 383  182 964 878  185 787 505" (3). The count leads and
 * the cumulative is the first amount after the label (the wide-gutter one), even
 * when the trailing month columns merge under a single space.
 *
 * Exported ONLY so it can be tested without a PDF fixture: `parseHospitalPaymentsPdf`
 * is otherwise untestable offline, and this line feeds BOTH completeness asserts, so
 * a regression here silently turns them off rather than failing.
 *
 * ⚠️ It is knowingly wrong on one real shape and the test pins that: when НЗОК emits
 * the two amount columns separated by a SINGLE space ("43  ОБЩО  644 030 052 115 383
 * 323", drugs 2024-06) the run reads as one 18-digit number and the drift assert then
 * rejects a file whose rows are perfectly correct. Fixing it is RC-2 / Tier 1 item 5
 * of docs/plans/nzok-hospital-parser-hardening-v1.md; until then the pinned
 * expectation is what makes that fix visibly flip a red test.
 */
export const readTotalLine = (
  line: string,
): { count: number; cumulative: number } | null => {
  const cnt = line.match(TOTAL_RE);
  if (!cnt) return null;
  const after = line.replace(/^.*?(?:Общо\s+РЗОК|ОБЩО)(?!\p{L})/u, "");
  const amts = [...after.matchAll(new RegExp(SIGNED_AMOUNT_RE))].map((mm) =>
    num(mm[0]),
  );
  if (!amts.length) return null;
  return { count: Number(cnt[1]), cumulative: amts[0] };
};

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

  // Grand total — see readTotalLine above for the shapes and the known RC-2 gap.
  const totalLine = lines.find((l) => TOTAL_RE.test(l));
  const total = totalLine ? readTotalLine(totalLine) : null;
  if (total) {
    headerFacilityCount = total.count;
    totalCumulativeEur = asEur(total.cumulative);
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
    // amount group starting the next (see SIGNED_AMOUNT_RE).
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
  // НЗОК's own facility count covers only the facilities it actually PAID in the
  // period. The table still LISTS zero-payment ones — some carrying a sequence
  // number (so they parse as ordinary rows), some not — and how many appear
  // varies month to month. Comparing against rows.length therefore drifts by
  // whatever that month happens to carry: 2026-06 listed 11 zero rows, 5 of them
  // seq-numbered, so the parser produced 381 + 5 = 386 and tripped the old ±2
  // window while every euro reconciled to the header (the extras are €0, so they
  // are invisible to the Σ assert above — this guard is the only one that sees
  // them).
  //
  // Count paid rows instead. That is what the header means, and it keeps the
  // guard sharp rather than blunting it: a parser that dropped a genuinely paid
  // facility still fails here, however many zero rows the month carries. `!== 0`
  // rather than `> 0` because ALL THREE streams legitimately carry negative
  // clawbacks (see SIGNED_AMOUNT_RE) — a facility НЗОК transacted with, not a
  // gap. Narrowing this to `> 0` on бмп would drop ДКЦ Св. София from the count.
  const paidRows = rows.filter((r) => r.cumulativeEur !== 0).length;
  if (headerFacilityCount && Math.abs(paidRows - headerFacilityCount) > 2)
    throw new Error(
      `facility-count mismatch for ${pdfPath}: parsed ${paidRows} paid row(s) ` +
        `(${rows.length} total, incl. ${rows.length - paidRows} zero-payment), ` +
        `header says ${headerFacilityCount}`,
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
