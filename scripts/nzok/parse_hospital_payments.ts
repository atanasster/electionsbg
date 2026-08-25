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
// per-РЗОК subtotal row before each region's facilities. Both are completeness
// asserts and NEITHER is skipped: since 2026-08-25 the per-block subtotals are the
// PRIMARY check — an absolute band, so a €129 error inside a €51m block is visible,
// and a failure names the block rather than handing back a whole document — the
// grand total is cross-checked against Σ of the blocks, and the old whole-file
// 0.5% ratio is kept only as a backstop for a document whose block structure did
// not parse at all. Neither subtotal nor total ever enters the facility list.

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

/** A block where НЗОК's printed facility count and the „№ по ред" ordinals we
 *  actually saw disagree. Descriptive, not an error — see `countMismatches`. */
export interface CountMismatch {
  block: string;
  /** The count НЗОК printed on this block's subtotal line. */
  printed: number;
  /** Distinct ordinals seen in this block. */
  numbered: number;
  /** Rows НЗОК listed without an ordinal — each can account for one absentee. */
  unnumbered: number;
  /** Ordinals in 1..printed that no row carried. */
  missingOrdinals: number[];
  /** Ordinals beyond `printed` — the block lists more than it counts. */
  extraOrdinals: number[];
}

export interface HospitalPaymentsFile {
  /** ISO end-of-period date the report is "към", e.g. "2026-05-31". */
  asOf: string;
  year: number;
  month: number;
  currencyOfRecord: "BGN" | "EUR";
  /** Grand total from the "Общо РЗОК" header row (YTD), in euros. May be negative
   *  in principle (both downstream guards take `Math.abs`); never is in practice.
   *  0 is a SENTINEL meaning "no total line in this document" — so a 0 here means
   *  the file loaded without the header cross-check or the whole-file backstop. It
   *  is NOT unverified: the per-block reconciliation runs regardless, and it is the
   *  stronger of the two. A total line that exists but cannot be read throws
   *  instead of landing here. */
  totalCumulativeEur: number;
  /** Rows the parser produced — INCLUDING zero-payment facilities, which НЗОК
   *  lists but does not count. NOT the header's own figure: that is
   *  `headerFacilityCount`, which means "facilities paid this period" and is what
   *  the count assert compares against. On bmp 2026-06 the two are 392 and 381,
   *  and `write_hospital_payments.ts` publishes THIS one into a committed
   *  artifact — so a consumer diffing it against НЗОК's printed header will see a
   *  gap, by design. */
  facilityCount: number;
  /** Blocks НЗОК printed no subtotal for, so their rows are NOT block-reconciled —
   *  only the whole-file ratio covers them. Empty is the normal case (125 of 127
   *  cached files); drugs 2023-03 prints one only for its single-facility blocks.
   *  Tier 0's coverage row stores this, so "loaded with partial verification"
   *  becomes a queryable fact rather than a line on stdout. */
  unreconciledBlocks: string[];
  /** Blocks whose row count disagrees with the count НЗОК printed for them, WITH
   *  the ordinals that are absent. Reported, never thrown: the money is guarded by
   *  the per-block reconciliation, and this figure means different things in
   *  different eras (see the comment beside `countMismatches` in the parser). This
   *  is what Tier 0's coverage row records as `countMismatch`. */
  countMismatches: CountMismatch[];
  /** The money inside `unreconciledBlocks`, in euros. */
  unreconciledEur: number;
  /** The count НЗОК prints on its own grand-total line ("facilities paid this
   *  period"), or 0 when the line could not be read. Returned beside the parsed
   *  count precisely because the two mean different things. */
  headerFacilityCount: number;
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
/**
 * A wrapped row's amount tokens, with any amount SPLIT ACROSS THE LINE BREAK
 * rejoined. Returns each candidate with the index it starts at, so the caller can
 * still bound the facility name.
 *
 * `pdftotext -layout` emits a wrapped row in reading order, which interleaves the
 * amount columns with the name fragments that wrapped — and it can cut one amount
 * in half, leaving its leading group on one line and its trailing group on the
 * next („…ЕООД279" then „464"). Two bare runs are rejoined only when the result is
 * ONE well-formed grouped amount, which is what keeps this off the far more common
 * case of two complete amounts sitting next to each other: „1 853 500" and
 * „146 500" would concatenate into a perfectly grouped 1 853 500 146 500, so the
 * first fragment must carry no internal separator of its own.
 */
const joinSplitGroups = (
  matches: RegExpMatchArray[],
  tail: string,
): { value: number; index: number; bare: boolean; raw: string }[] => {
  const out: { value: number; index: number; bare: boolean; raw: string }[] =
    [];
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i][0];
    const next = matches[i + 1]?.[0];
    // The two halves must be separated by an actual LINE BREAK. Without that,
    // a wrapped row whose YTD and month are both bare 3-digit runs („…ЕООД  255
    // 255") joins them into 255 255 — two complete columns fused into one figure.
    const between =
      next === undefined
        ? ""
        : tail.slice(
            (matches[i].index ?? 0) + cur.length,
            matches[i + 1].index ?? 0,
          );
    if (
      next !== undefined &&
      between.includes("\n") &&
      !/[ \t\u00a0]/.test(cur) &&
      /^\d{3}$/.test(next) &&
      GROUPED_AMOUNT.test(`${cur} ${next}`)
    ) {
      out.push({
        value: num(`${cur} ${next}`),
        index: matches[i].index ?? -1,
        bare: false,
        raw: `${cur} ${next}`,
      });
      i++;
    } else
      out.push({
        value: num(cur),
        index: matches[i].index ?? -1,
        bare: !/[ \t\u00a0]/.test(cur),
        raw: cur,
      });
  }
  return out;
};

export const extractAmounts = (
  tail: string,
  stream: PaymentStream = "bmp",
): { name: string; cumulative: number; month: number } | null => {
  const lenient = isLenient(stream);
  // One reader, but still a factory: `matchAll` reads `lastIndex` off the source
  // regex, so every scan gets its own copy rather than sharing mutable state with
  // the module constant. Kept deliberately, not a leftover from the two-regex fork.
  const re = () => new RegExp(SIGNED_AMOUNT_RE);
  // ⚠️ A BARE run of 5+ digits is not money, on any path. These reports are Excel
  // exports and space-group every amount above 999, so an ungrouped long run is a
  // 10-digit Рег.№ ЛЗ that arrived inside an ABSORBED line — which is what a
  // row-matching defect produces (a line the row regex fails to recognise is
  // appended to its predecessor's tail). Measured: „0306391032" was read as an
  // amount and would publish МБАЛ-Девня at €156,655,247. Dropping it here rather
  // than in one branch keeps the candidate rule and the wrapped reconstruction
  // from disagreeing about what counts as an amount.
  //
  // The bound is 999, not a looser round number, because it IS the invariant: the
  // only bare runs above 999 anywhere in the cache are the name years „2012" (×90)
  // and „2003" (×50), never an amount.
  const isAmountToken = (t: string): boolean =>
    /[ \t\u00a0]/.test(t) || Math.abs(num(t)) <= 999;
  const all = [...tail.matchAll(re())].filter((m) => isAmountToken(m[0]));
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
    // Candidate A rescans a slice, so it must apply the same token filter or a
    // Рег.№ from an absorbed line re-enters through this path alone.
    const rm = [...region.matchAll(re())].filter((m) => isAmountToken(m[0]));
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

  // ── A WRAPPED row: the candidate rule above reads a name fragment as the amount.
  //
  // The two candidates are "first amount after the last name letter" and
  // "second-to-last amount of the row". Both assume the amounts come LAST. When a
  // row wraps, `pdftotext -layout` emits it in reading order and interleaves the
  // amount columns with the name text that wrapped, so both land on a fragment:
  // „МИ-МВР-ФИЛИАЛ ВАРНА …" published €47 against a true €522,872 for 2024-12 and
  // €36 against €545,021 for 2025-12, with the amount baked into the stored name.
  //
  // ⚠️ The plan (Tier 1 item 3) prescribes reading the amounts from the header's
  // COLUMN POSITIONS. That is only PARTLY unavailable, and the first draft of this
  // comment overstated it. Re-measured across 302 wrapped rows: 86.6% of amount
  // tokens do land exactly on a right-edge column derived from the file's own
  // ordinary rows. What breaks an exact read is the minority where the YTD's
  // leading digit collides with the wrapped name and is pushed LEFT (bmp 2024-12
  // and 2025-12: column 110 → 103) — which is precisely the shape this branch
  // exists for. A right-edge-NEAREST column read would cover both and is the
  // better fix; it is not what ships here, and that is a deliberate deferral
  // rather than an impossibility.
  //
  // What IS invariant without any column: the year-to-date is the LARGEST figure
  // in the row — ≥ its own month, ≥ each month of a 3-column file, and ≥ any
  // name-fragment digit. Verified against НЗОК's own per-РЗОК subtotals across the
  // whole cache.
  //
  // Four conditions keep it narrow, and each is load-bearing:
  //  · only on a row that actually wrapped — a single-line row is what the
  //    candidate rule was built and tested for;
  //  · only on `bmp`. The clamp above is `!lenient`-gated because a lenient month
  //    legitimately exceeds its own YTD when an earlier clawback dragged the YTD
  //    down (devices 2023-02, УМБАЛ Александровска). "Largest is the YTD" is the
  //    same assumption, so it must carry the same gate — without it a wrapped
  //    Александровска has its two figures SWAPPED;
  //  · only when no token is negative — "largest" is the wrong comparison for a
  //    clawback (−50 > −100), and no wrapped row in the cache carries one;
  //  · only when the largest figure is a real amount rather than a stray digit
  //    (> 999). A wrapped €0 facility whose name carries a „2" would otherwise be
  //    published at €2 and counted as PAID.
  if (
    !lenient &&
    tail.includes("\n") &&
    all.length >= 2 &&
    all.every((m) => num(m[0]) >= 0)
  ) {
    const cands = joinSplitGroups(all, tail);
    const top = cands.reduce((a, b) => (b.value > a.value ? b : a));
    if (top.value > 999) {
      if (top.value > cumulative) {
        cumulative = top.value;
        cumIdx = top.index;
      }
      // ⚠️ The MONTH must be recomputed even when the cumulative was already
      // right, and this branch used to be skipped entirely in that case. On 31 of
      // the 33 cached МИ-МВР months the YTD sits BETWEEN the two halves of the
      // split month („…ПРОДЪЛЖИТЕЛНО 45 ⏎ 133 792 ЛЕЧЕНИЕ ⏎ 366 И РЕХА"), so the
      // candidate rule reads the YTD correctly and the month published as 366
      // against a true 45 366 — €1,245,472 across the loaded months. Reconciling
      // the cumulative against the per-РЗОК subtotals is structurally blind to it,
      // which is why it survived the first cut of this change.
      //
      // `joinSplitGroups` cannot rescue those: it only fuses ADJACENT tokens, and
      // here the YTD is in between. Rather than guess which fragments pair up, a
      // row that still carries a loose bare fragment records the month as 0
      // ("unknown") — the same choice the merged-column clamp makes, and the only
      // one that cannot publish a wrong figure about a named facility.
      // The month is the FIRST figure after the year-to-date, not the largest —
      // matching what the candidate rule does on an ordinary row. A 3-column file
      // prints YTD, then the first month, then the second, and this field has
      // always carried the FIRST of them; taking the largest instead made a
      // wrapped row report February while every ordinary row in the same file
      // reported January.
      //
      // (Whether this field SHOULD be the first month or the report month is a
      // separate, pre-existing question — the header says „в т.ч. касово
      // изпълнение за месец", and 3-column files name two. Not decided here; what
      // matters is that one file does not answer it two ways.)
      const rest = cands.filter(
        (c) => c !== top && c.index > top.index && c.value <= cumulative,
      );
      // "Loose fragment" means a bare run of EXACTLY three digits — the shape of a
      // thousands group that lost its leading part („366" out of „45 366"). A
      // shorter bare run is an ordinary name-index digit („…заведение 48") and
      // must not cost that row its perfectly good month.
      const fragmented = rest.some((c) => c.bare && c.raw.length === 3);
      month = fragmented || !rest.length ? 0 : rest[0].value;
    }
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
// ⚠️ The РЗОК code is `\d{1,2}`, NOT `\d{2}`, and the difference is one row of
// real money. НЗОК renders the code with its leading zero in every line but one:
// bmp 2023-01 prints „ 3     Варна   23   0306391032   ДЦ ХИПОКРАТ ЕООД   4 277"
// with the zero dropped. Under `\d{2}` that line does not start a row — so it is
// treated as a wrapped CONTINUATION and appended to its predecessor's tail, which
// is the corruption the note above describes: МБАЛ-Девня ЕООД (0314211005) would
// publish ХИПОКРАТ's 4,277 BGN instead of its own 255, and ДЦ ХИПОКРАТ disappears
// from the report entirely. The whole-file Σ moves by 255 BGN — 0.0001% — so only
// the facility-count assert ever saw it.
//
// Measured across the cache: widening to `\d{1,2}` newly matches that row and
// nothing else — 3 occurrences, being two byte-identical copies of bmp 2023-01
// plus a probe file the loader's YEARS excludes. No line stops matching. The code
// is padded back to two digits in `matchRowStart` so a short-rendered row still
// groups with its own РЗОК.
//
// ⚠️ This does NOT put ДЦ ХИПОКРАТ on the site. bmp 2023-01 is still rejected —
// the facility-count assert now reads 364 paid against a header of 373 — so the
// served corpus is unchanged and this is a PRE-CONDITION for Tier 2 rather than a
// corpus repair. What it does change is that the file's blocks now reconcile to
// НЗОК's own subtotals exactly, so when Tier 2 admits the month it admits a
// correct one.
const ROW_START_RE =
  /^\s*(\d{1,2})\s+(\S[^\d]*?)\s+(?:(\d+)\s+)?(\d{10})\b(.*)$/;
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
 * Read one occurrence of the header grand-total line — the facility count and the
 * year-to-date — e.g. "381  Общо РЗОК  942 127 532  191 249 510" (2 columns) or
 * "380  Общо РЗОК  368 752 383  182 964 878 185 787 505" (3, where the two month
 * columns merge under a single space and the YTD still splits off cleanly).
 *
 * `columns` reports how many amount COLUMNS the line separated into, because that
 * is what tells a usable rendering from a broken one — see RC-2 below.
 *
 * Exported for testing: `parseHospitalPaymentsPdf` is otherwise untestable
 * offline, and this line feeds BOTH completeness asserts, so a regression here
 * does not fail a file — it silently turns the guards off.
 */
export const readTotalLine = (
  line: string,
): { count: number; cumulative: number; columns: number } | null => {
  const cnt = line.match(TOTAL_RE);
  if (!cnt) return null;
  const after = line.replace(/^.*?(?:Общо\s+РЗОК|ОБЩО)(?!\p{L})/u, "");
  // The gutter between columns is a run of 2+ spaces; a single space inside a
  // column is the thousands separator. Splitting on the gutter is therefore the
  // only reading that can tell "644 030 052" from "644 030 052 115 383 323".
  // ⚠️ A column must be a WELL-FORMED amount, not merely "free of letters". The
  // first cut of this filter accepted anything without a letter, so a „-"-only
  // or hyphen-infixed column parsed to NaN — and `Math.abs(NaN) > 0` is FALSE,
  // which silently switches the Σ reconciliation assert OFF while
  // `write_hospital_payments.ts` publishes the total as 0 (BGN, via `toEur`) or
  // null (EUR, via JSON.stringify) into a committed artifact typed `number`.
  // The token scan this replaced could not reach that state. Unobserved across
  // 760 total-line occurrences; the MODE is the problem, not the rate.
  const cols = after
    .split(/\s{2,}/)
    .map((c) => c.trim())
    .filter((c) => /^-?[\d\s]*\d[\d\s]*$/.test(c));
  if (!cols.length) return null;
  const cumulative = num(cols[0]);
  // Deliberately redundant with the predicate above — either alone stops the NaN,
  // and the test only goes red when BOTH are removed (mutation-checked). Kept as a
  // pair because the failure they prevent is silent: a NaN total does not throw,
  // it switches the reconciliation assert off and publishes 0/null downstream.
  if (!Number.isFinite(cumulative)) return null;
  return {
    count: Number(cnt[1]),
    cumulative,
    columns: cols.length,
  };
};

/**
 * Does this line START a facility row, and if so what are its four fields?
 *
 * Exported for testing: RC-3d lives in WHICH LINES START A ROW and in the
 * zero-padding of the captured code, and neither is visible to `extractAmounts`,
 * which only ever sees the tail. A test that rebuilds the regex locally instead
 * of calling this passes with the fix REVERTED — measured, both halves survived
 * that mutation.
 */
export const matchRowStart = (
  line: string,
): {
  rzokCode: string;
  rzokName: string;
  /** НЗОК's „№ по ред" for this facility within its РЗОК block, or null where the
   *  row is listed without one. The numbering restarts per block, so a block's
   *  ordinals should run 1..n against the count its subtotal prints — which is a
   *  far sharper completeness statement than any total, because it names WHICH
   *  facility is missing rather than how many. НЗОК leaves it blank on some
   *  zero-payment rows, which is why it is nullable and why an unnumbered row is
   *  counted separately rather than treated as a gap. */
  ordinal: number | null;
  regNo: string;
  tail: string;
} | null => {
  const m = line.match(ROW_START_RE);
  if (!m) return null;
  const [, code, name, ord, regNo, rest] = m;
  return {
    ordinal: ord === undefined ? null : Number(ord),
    // Padded: the code is a 2-digit РЗОК identifier and one line in the corpus
    // renders it without its leading zero. Storing "3" beside "03" would split
    // one region's facilities across two codes in every rollup.
    rzokCode: code.padStart(2, "0"),
    rzokName: name.trim(),
    regNo,
    tail: rest,
  };
};

/**
 * Choose which occurrence of the grand-total line to believe.
 *
 * НЗОК repeats it on every page, and one rendering can separate the two amount
 * columns by a SINGLE space — so `columns` is the discriminator: a reading that
 * separated into 2+ columns saw the year-to-date split off from the month, one
 * that did not has them fused into a single run. Exported because this selection
 * IS the whole of RC-2, and it is otherwise reachable only through a PDF.
 */
/** A per-РЗОК subtotal line: the block's own count, name and amounts. НЗОК prints
 *  one above every block, e.g.
 *
 *    "                    83                   РЗОК София град      18 472 390    3 917 276"
 *
 *  This is the SECOND, finer copy of the same truth as the grand total, and it is
 *  the only ground truth available offline for WHICH rows are wrong rather than
 *  merely that some are. Measured across the cache: Σ of the block subtotals
 *  equals the header total in 127 of 127 files (±€3), and Σ of the block counts
 *  equals the header count in 126 of 127. */
const SUBTOTAL_RE = /^\s*(\d+)\s+РЗОК\s+(\S.*?)\s{2,}(.*)$/;

/** Read one block subtotal line. Same gutter rule as `readTotalLine` — a run of
 *  2+ spaces separates columns, a single space is the thousands separator. */
export const readSubtotalLine = (
  line: string,
): {
  count: number;
  name: string;
  cumulative: number;
  columns: number;
} | null => {
  const m = line.match(SUBTOTAL_RE);
  if (!m) return null;
  const cols = m[3]
    .split(/\s{2,}/)
    .map((c) => c.trim())
    .filter((c) => /^-?[\d\s]*\d[\d\s]*$/.test(c));
  if (!cols.length) return null;
  const cumulative = num(cols[0]);
  if (!Number.isFinite(cumulative)) return null;
  // `columns` for the same reason `readTotalLine` reports it: these subtotals come
  // from the SAME renderer as the grand total, whose columns can fuse under a
  // single space (RC-2) — and the subtotal columns are narrower, so they have less
  // margin, not more. Zero fused occurrences in the cache today; the caller
  // prefers a 2+-column rendering so a fused one cannot win first-occurrence.
  return {
    count: Number(m[1]),
    name: m[2].trim(),
    cumulative,
    columns: cols.length,
  };
};

/** How far a summed figure may sit from the single rounded figure НЗОК printed.
 *
 *  Each summand is rounded to the euro independently and the printed figure is
 *  rounded once, so the drift grows with the NUMBER OF SUMMANDS — which is why
 *  this takes a count rather than being a constant, and why the same helper serves
 *  both a block (summands = its rows) and the whole-file cross-check (summands =
 *  its blocks).
 *
 *  ⚠️ ABSOLUTE, never proportional. That is the entire reason this check exists:
 *  a 0.5% ratio over a €182m file cannot see €129, and every one of the eleven
 *  months that shipped €1,672,123 of wrong money passed it. Measured across 3,700
 *  blocks the legitimate band tops out at €6 and the worst diff/tolerance ratio is
 *  0.273; the smallest REAL defect ever caught this way was €129 on a 23-row
 *  block. `max(10, n)` sits in that gap with slack on both sides. */
export const blockTolerance = (summands: number): number =>
  Math.max(10, summands);

export const pickTotal = <T extends { columns: number }>(
  totals: T[],
): T | undefined => totals.find((t) => t.columns >= 2) ?? totals[0];

/**
 * A completeness assert refusing a month — carrying what НЗОК itself said about it.
 *
 * The point is that a refusal is not an absence of information. Every one of these
 * fires AFTER the period and the grand-total line have been read, so the coverage
 * row for a withheld month can still state which month it is and what НЗОК says it
 * was worth — measured, the header total parses correctly in 23 of the 24 files the
 * old asserts rejected. Without this the loader catches a bare Error, and a
 * withheld month becomes a string in a log rather than a queryable fact.
 *
 * Only the COMPLETENESS asserts throw this. A document that is not a report at all
 * — pdftotext failing, no „към DD.MM.YYYY" period — throws a plain Error, because
 * there are no facts to carry and inventing a shape for them would be worse.
 */
export class HospitalPaymentsRefusal extends Error {
  constructor(
    message: string,
    readonly facts: {
      asOf: string;
      headerFacilityCount: number;
      /** НЗОК's own grand total for the month, in euros. 0 when unreadable. */
      totalCumulativeEur: number;
      currencyOfRecord: "BGN" | "EUR";
      /** Rows the parser did produce, before it refused to publish them. */
      rowsParsed: number;
    },
  ) {
    super(message);
    this.name = "HospitalPaymentsRefusal";
  }
}

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

  // Every completeness refusal carries the month's own figures — see
  // `HospitalPaymentsRefusal`.
  //
  // Declared HIGH, immediately after the period is parsed and the accumulators
  // exist, because the earliest refusal (an unreadable grand-total line) fires
  // before a single row is read. It closes over the accumulators, so each refusal
  // reports the state AT THE MOMENT IT FIRED — zeros for the early one, the full
  // header and row count for the late ones. That is the honest reading: a month
  // refused before its total could be read genuinely has no total to report, and a
  // coverage row saying so is still worth more than no row at all.
  const refuse = (message: string): never => {
    throw new HospitalPaymentsRefusal(message, {
      asOf: iso,
      headerFacilityCount,
      totalCumulativeEur,
      currencyOfRecord: currency,
      rowsParsed: rows.length,
    });
  };

  // ── The grand total, read from the BEST occurrence rather than the first.
  //
  // ⚠️ RC-2: НЗОК repeats this line on every page, and one rendering of it can
  // separate the two amount columns by a SINGLE space — drugs 2024-06 prints
  // „43  ОБЩО  644 030 052 115 383 323" on page 1 and the same figures with a
  // proper gutter on pages 2-5. Taking the first occurrence read that run as ONE
  // 18-digit number, so the header total became 3.29 × 10¹⁷, the drift assert saw
  // 100% and REJECTED a file whose rows were perfectly correct (Σ €329,287,339
  // against a true 644,030,052 BGN — the rows and the real header agree to €2).
  //
  // A file that merges the columns in EVERY occurrence would still misread, and
  // that is left alone deliberately: the drift assert then rejects the file, which
  // is the loud failure. What is fixed here is throwing away four good readings.
  const totals = lines
    .filter((l) => TOTAL_RE.test(l))
    .map(readTotalLine)
    .filter((t): t is NonNullable<typeof t> => t !== null);
  const total = pickTotal(totals);
  if (total) {
    headerFacilityCount = total.count;
    totalCumulativeEur = asEur(total.cumulative);
  } else if (lines.some((l) => TOTAL_RE.test(l)))
    // ⚠️ The line is THERE and none of its occurrences could be read. Falling
    // through would leave `headerFacilityCount` and `totalCumulativeEur` at 0, and
    // BOTH completeness asserts below are guarded on those being non-zero — so the
    // file would load with no verification at all, which is worse than rejecting
    // it. (A file carrying no total line whatsoever is a different case and still
    // falls through; one such file is in the cache, outside the loader's YEARS.)
    refuse(
      `unreadable grand-total line in ${pdfPath}: ` +
        `${lines.filter((l) => TOTAL_RE.test(l)).length} occurrence(s), none yielding an amount column`,
    );

  // Accumulate logical rows: a row starts at a ROW_START_RE line and absorbs any
  // following continuation lines (a wrapped long name / an amount pushed to the
  // next line) until the next row start, a subtotal/total, or a blank line. Then
  // the trailing two numbers of the accumulated text are the amounts.
  let pending: {
    rzokCode: string;
    rzokName: string;
    ordinal: number | null;
    regNo: string;
    tail: string;
  } | null = null;
  /** Per block: the „№ по ред" ordinals seen, and how many rows carried none. */
  const seenOrdinals = new Map<string, Set<number>>();
  const unnumberedRows = new Map<string, number>();
  const flush = () => {
    if (!pending) return;
    const tail = isLenient(stream)
      ? repairGluedThousands(pending.tail)
      : pending.tail;
    const parsed = extractAmounts(tail, stream);
    // ⚠️ Ordinals are recorded here, at row EMIT, not where the row STARTS. A row
    // whose amounts do not parse produces nothing, and counting its ordinal there
    // would report a facility as present that never reached the corpus — the
    // report would then be describing the document rather than the data.
    if (parsed) {
      if (pending.ordinal === null)
        unnumberedRows.set(
          pending.rzokName,
          (unnumberedRows.get(pending.rzokName) ?? 0) + 1,
        );
      else
        (
          seenOrdinals.get(pending.rzokName) ??
          seenOrdinals.set(pending.rzokName, new Set()).get(pending.rzokName)!
        ).add(pending.ordinal);
      rows.push({
        rzokCode: pending.rzokCode,
        rzokName: pending.rzokName,
        regNo: pending.regNo,
        name: parsed.name,
        cumulativeEur: asEur(parsed.cumulative),
        monthEur: asEur(parsed.month),
      });
    }
    pending = null;
  };

  for (const line of lines) {
    const start = matchRowStart(line);
    if (start) {
      flush();
      pending = { ...start };
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

  // ── Completeness, per РЗОК BLOCK.
  //
  // The whole-file Σ assert below is kept, but it is the backstop rather than the
  // check. It is a RATIO over the whole document, so a single wrong row averages
  // away: measured, 11 loaded months carried €1,672,123 of wrong money — including
  // МИ-МВР-ФИЛИАЛ ВАРНА at €47 against a true €522,872 — every one of them under
  // the 0.5% band. And a ratio cannot say WHICH row is wrong, so a failure is a
  // whole file to hand-inspect.
  //
  // НЗОК prints a subtotal above each block, so each block is an independent
  // statement of what its rows must sum to. That localises a defect to ~20 rows
  // and, being absolute rather than proportional, sees a €129 error inside a €51m
  // block — which the ratio never could.
  const subtotalReadings = new Map<
    string,
    ReturnType<typeof readSubtotalLine>[]
  >();
  for (const line of lines) {
    const sub = readSubtotalLine(line);
    // The subtotal repeats on every page the block spans, so collect them all and
    // let `pickTotal` choose — first-occurrence-wins would have no defence if one
    // rendering fused its columns, which is exactly what RC-2 was.
    if (sub)
      subtotalReadings.set(sub.name, [
        ...(subtotalReadings.get(sub.name) ?? []),
        sub,
      ]);
  }
  const subtotals = new Map<string, { count: number; cumulative: number }>();
  for (const [name, readings] of subtotalReadings) {
    const best = pickTotal(readings.filter((r) => r !== null));
    if (best)
      // `count` is НЗОК's own per-block figure. Unused by the money arm here; it
      // is what the count model (Tier 2 step 2) reconciles the ordinals against.
      subtotals.set(name, {
        count: best.count,
        cumulative: asEur(best.cumulative),
      });
  }

  const perBlock = new Map<string, { cum: number; rows: number }>();
  for (const r of rows) {
    const b = perBlock.get(r.rzokName) ?? { cum: 0, rows: 0 };
    b.cum += r.cumulativeEur;
    b.rows++;
    perBlock.set(r.rzokName, b);
  }

  const offBlocks = [...subtotals]
    .map(([name, sub]) => {
      const got = perBlock.get(name) ?? { cum: 0, rows: 0 };
      return { name, sub, got, diff: sub.cumulative - got.cum };
    })
    .filter((b) => Math.abs(b.diff) > blockTolerance(b.got.rows));
  if (offBlocks.length)
    refuse(
      `block reconciliation failed for ${pdfPath}: ` +
        offBlocks
          .map(
            (b) =>
              `РЗОК ${b.name} — НЗОК €${b.sub.cumulative} vs Σ ${b.got.rows} parsed row(s) €${b.got.cum} (off €${b.diff})`,
          )
          .join("; "),
    );

  // The other direction: Σ of the blocks against the header's own grand total.
  // This catches a MISREAD HEADER, which no per-block check can see — RC-2's
  // single-space column merge made the header 3.29 × 10¹⁷ while every block
  // reconciled perfectly.
  //
  // ⚠️ Only when the subtotals COVER every block that has rows. A partial set is
  // not a smaller version of the total, it is a different quantity: drugs 2023-03
  // prints a subtotal only for its single-facility blocks, so 9 of its 16 blocks
  // have none — and comparing those 9 against the header reported €104,587,839
  // "missing" from a file whose Σ matches its header to the euro. Where coverage
  // is partial the per-block checks above still run on the blocks that do have
  // one; it is only this whole-file identity that becomes meaningless.
  //
  // ⚠️ And it is REPORTED rather than applied silently. Where a block prints no
  // subtotal its rows are reconciled by nothing but the whole-file ratio, and on
  // drugs 2023-03 that is 32 of 41 rows — 84.5% of the file's money. A guard that
  // switches itself off without saying so is the shape this whole plan is about.
  const uncovered = [...new Set(rows.map((r) => r.rzokName))].filter(
    (n) => !subtotals.has(n),
  );
  const unreconciledEur = rows
    .filter((r) => uncovered.includes(r.rzokName))
    .reduce((sum, r) => sum + r.cumulativeEur, 0);
  if (uncovered.length)
    console.warn(
      `[nzok] ${pdfPath}: ${uncovered.length} block(s) print no subtotal ` +
        `(${uncovered.join(", ")}) — €${unreconciledEur} across ` +
        `${rows.filter((r) => uncovered.includes(r.rzokName)).length} row(s) ` +
        `is reconciled only by the whole-file ratio`,
    );
  // `rows.length > 0` because `every` on an empty set is vacuously true, and an
  // empty parse must not read as "fully covered".
  const covered = rows.length > 0 && !uncovered.length;
  if (covered && subtotals.size && Math.abs(totalCumulativeEur) > 0) {
    const blockSum = [...subtotals.values()].reduce(
      (a, b) => a + b.cumulative,
      0,
    );
    const drift = Math.abs(blockSum - totalCumulativeEur);
    if (drift > blockTolerance(subtotals.size))
      refuse(
        `header total disagrees with its own blocks for ${pdfPath}: ` +
          `header €${totalCumulativeEur} vs Σ ${subtotals.size} block subtotal(s) €${blockSum} (off €${drift})`,
      );
  }

  // Backstop — the whole-file ratio. It costs nothing and it is the only thing
  // left for a document whose block structure did not parse at all (no subtotal
  // line matched), where every check above is vacuous.
  if (Math.abs(totalCumulativeEur) > 0) {
    const sum = rows.reduce((s, r) => s + r.cumulativeEur, 0);
    const drift =
      Math.abs(sum - totalCumulativeEur) / Math.abs(totalCumulativeEur);
    if (drift > 0.005)
      refuse(
        `reconciliation failed for ${pdfPath}: Σ facilities €${sum} vs header €${totalCumulativeEur} (drift ${(drift * 100).toFixed(2)}%, ${rows.length} rows parsed vs ${headerFacilityCount} expected)`,
      );
  }
  // ── Every facility НЗОК printed must have reached a row.
  //
  // ⚠️ This is what replaces the deleted facility-count assert, and it is not the
  // same guard — it is a stronger one. The count assert was the ONLY thing that
  // could see a dropped ZERO-payment facility: such a row moves no money, so the
  // block reconciliation is blind to it, and it leaves no ordinal gap either.
  // Measured, a printed €0 row never carries a distinct in-range ordinal — it is
  // unnumbered (660 rows), shares its paid neighbour's number (4 blocks in bmp
  // 2026-06), or trails past the printed count (Русе #8 against printed=7). So
  // dropping one would have been invisible to everything below.
  //
  // The Рег.№ is the honest universe: ten contiguous digits, one per facility the
  // document prints. Anything that starts a row and does not finish as one is a
  // drop, whatever it was worth. Measured clean on 168 of 168 cached files, which
  // is why it can be an assert rather than a report.
  const printedRegNos = new Set(
    lines
      .map((l) => matchRowStart(l)?.regNo)
      .filter((r): r is string => r !== undefined),
  );
  const emitted = new Set(rows.map((r) => r.regNo));
  const lost = [...printedRegNos].filter((r) => !emitted.has(r));
  if (lost.length)
    refuse(
      `dropped facility row(s) in ${pdfPath}: Рег.№ ${lost.join(", ")} ` +
        `start a row but produced none (${printedRegNos.size} printed, ${emitted.size} emitted)`,
    );

  // ── The COUNT, reported and never thrown.
  //
  // НЗОК's own facility count used to be an assert here, with a ±2 window, and it
  // is the reason 11 of 127 files were withheld from the site while every euro in
  // them reconciled. It cannot be an assert, because the number does not mean one
  // thing:
  //
  //  · in 2023 it counts the facilities LISTED (paid plus zero-payment);
  //  · from 2024 it counts the facilities PAID, and the table still lists unpaid
  //    ones — 2026-06 lists 11, five of them numbered;
  //  · devices 2023-06/07 print София град's count as 83, which is the БМП
  //    report's Sofia count, not this report's 27 — НЗОК's own typo, and the money
  //    reconciles to the euro either way;
  //  · bmp 2026-01 counts 388 facilities and PRINTS 380 — the other 8 appear in no
  //    extraction mode, so they are counted and never rendered.
  //
  // Only the last two are НЗОК's bookkeeping rather than ours, and no rule can
  // separate them from a real drop by counting. What CAN: the „№ по ред" ordinal,
  // which restarts per block — a block whose subtotal says 8 and whose ordinals
  // are {1,2,3,4,6,7,8} is missing #5 by name, and that is a fact rather than a
  // discrepancy. The money is guarded by the block reconciliation above, which is
  // the strong check; this one exists to say WHAT is absent when nothing is wrong.
  //
  // ⚠️ A block with no subtotal line is NOT checked here, and that is reported
  // rather than passed over: `unreconciledBlocks` already names them for the money
  // arm and the same blocks are uncounted. On drugs 2023-03 that is 7 of 16 blocks
  // and 32 of 41 rows — an empty `countMismatches` there means "nothing checked",
  // not "nothing wrong", and the two must never read the same.
  const countMismatches: CountMismatch[] = [];
  for (const [name, sub] of subtotals) {
    const seen = seenOrdinals.get(name) ?? new Set<number>();
    const unnumbered = unnumberedRows.get(name) ?? 0;
    const missing: number[] = [];
    for (let i = 1; i <= sub.count; i++) if (!seen.has(i)) missing.push(i);
    const extra = [...seen].filter((o) => o > sub.count).sort((a, b) => a - b);
    // ⚠️ An unnumbered row is NOT evidence that a particular ordinal is present, and
    // an earlier version cancelled one missing ordinal per unnumbered row on the
    // premise that НЗОК blanks „№ по ред" on zero-payment rows. That premise is
    // false: 23 unnumbered rows carry money, including МБАЛ Болница Европа at
    // €1.19m–€1.93m across six bmp months. The rule also fired in 0 of 4,116
    // blocks, so it was untested cancellation logic guarding nothing. `unnumbered`
    // is REPORTED beside the gap instead — a reader can see both facts, and the
    // parser asserts nothing it cannot support.
    if (missing.length || extra.length)
      countMismatches.push({
        block: name,
        printed: sub.count,
        numbered: seen.size,
        unnumbered,
        missingOrdinals: missing,
        extraOrdinals: extra,
      });
  }

  return {
    asOf: iso,
    year,
    month,
    currencyOfRecord: currency,
    totalCumulativeEur,
    facilityCount: rows.length,
    unreconciledBlocks: uncovered,
    countMismatches,
    unreconciledEur,
    headerFacilityCount,
    rows,
  };
};
