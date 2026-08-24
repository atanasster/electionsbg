// Unit tests for the НЗОК hospital-payment parser's four pure seams:
//
//   extractAmounts        the amounts and name of one row's accumulated tail
//   repairGluedThousands  the pdftotext glue artifact (RC-1)
//   matchRowStart         which lines start a row, and the РЗОК padding (RC-3d)
//   readTotalLine         one occurrence of the grand-total line, and pickTotal
//                         which of its occurrences to believe (RC-2)
//
// The whole-corpus counterpart is hospital_payments_corpus.test.ts, which runs the
// real parser over every cached PDF and reconciles each РЗОК block against НЗОК's
// own printed subtotal. Neither file replaces the other: every defect in
// docs/plans/nzok-hospital-parser-hardening-v1.md lived in the ASSEMBLY these
// seams sit inside, and every one of them is a specific string shape.
//
// Layout matrix for the amount extractor — the single most
// bug-prone unit in the health pack (it regressed once, commit a9dfef1aa, when a
// last-letter anchor misread a glued name+amount and dropped €201K under the
// ±0.5% reconciliation tolerance). `extractAmounts` is pure (string in, number
// out), so it locks cheaply without a PDF fixture.
//
// Cases carrying a `stream` exercise the lenient (`drugs`/`devices`) path; the
// rest default to `bmp`.
//
// The cases added on 2026-08-24 are TRANSCRIBED verbatim from cached PDFs —
// ДКЦ Св. София, МБАЛ - Дулово, МБАЛ Св. Иван Рилски-2003, КОЦ - Бургас,
// УМБАЛ Александровска. The older cases are synthetic minimal shapes, and the
// round figures in "УМБАЛ Пловдив АД" are INVENTED (12 500 000 has 0 hits
// corpus-wide) — worth knowing before treating any of them as evidence.
//
// The four Токуда glue spacings (RC-1) ARE covered, as of Tier 1 item 2 — all
// four transcribed verbatim from the devices reports that carry them. They are
// the reason this header used to over-claim: a fixture list that says it covers
// a shape, and does not, is worse than one that admits the gap.
//
//   npm run test:nzok
//
// Each `tail` is the text AFTER the 10-digit Рег.№ (what ROW_START_RE's `(.*)`
// captures), in `pdftotext -layout` shape: WIDE gutters between the two amount
// columns, single spaces only inside a thousands group. Expected values are the
// current reconciliation-verified behaviour — a change here is a real regression.

import { test } from "vitest";
import assert from "node:assert/strict";
import {
  extractAmounts,
  matchRowStart,
  pickTotal,
  readTotalLine,
  repairGluedThousands,
  type PaymentStream,
} from "./parse_hospital_payments";

const CASES: {
  label: string;
  tail: string;
  stream?: PaymentStream;
  expect: { name: string; cumulative: number; month: number } | null;
}[] = [
  {
    label: "2-column normal row",
    tail: "МБАЛ Благоевград АД   4 684 771   903 437",
    expect: { name: "МБАЛ Благоевград АД", cumulative: 4684771, month: 903437 },
  },
  {
    label: "3-column early-year merge (max picks cumulative)",
    tail: "УМБАЛ Пловдив АД 12 500 000 5 000 000 7 500 000",
    expect: { name: "УМБАЛ Пловдив АД", cumulative: 12500000, month: 5000000 },
  },
  {
    label: "name glued to first amount (the a9dfef1aa regression case)",
    tail: "Диагностичен център ЕООД242 730   41 414",
    expect: {
      name: "Диагностичен център ЕООД",
      cumulative: 242730,
      month: 41414,
    },
  },
  {
    label: "wrapped long name — trailing name-fragment digit ignored",
    tail: "Много дълго име на лечебно заведение 48\n   230 716   45 000",
    expect: {
      name: "Много дълго име на лечебно заведение 48",
      cumulative: 230716,
      month: 45000,
    },
  },
  {
    label: "month reads larger than cumulative → month clamped to 0",
    tail: "Болница   100 000   250 000",
    expect: { name: "Болница", cumulative: 100000, month: 0 },
  },
  {
    label: "zero-payment facility is kept (€0, not dropped)",
    tail: "Нова болница ЕООД   0   0",
    expect: { name: "Нова болница ЕООД", cumulative: 0, month: 0 },
  },
  {
    label: "name-embedded index digit not read as the amount",
    tail: "МБАЛ 2   500 000   120 000",
    expect: { name: "МБАЛ 2", cumulative: 500000, month: 120000 },
  },
  {
    label: "fewer than two amounts → rejected (subtotal/garbage line)",
    tail: "Само едно число   123",
    expect: null,
  },
  // ── the signed reader (2026-08-24). БМП carries clawbacks; the unsigned reader
  //    published „ДКЦ Св. София ЕООД -10 180" as +10,180 for six months and left
  //    the minus in the name. Verbatim from bmp 2023-09, София град row 81.
  {
    label: "БМП negative cumulative is read as negative, not inverted",
    tail: "ДКЦ Св. София ЕООД                    -10 180                 0",
    expect: { name: "ДКЦ Св. София ЕООД", cumulative: -10180, month: 0 },
  },
  {
    label:
      "БМП negative month is read as negative (bmp 2023-06, МБАЛ - Дулово)",
    tail: "МБАЛ - Дулово ЕООД                     1 404 214           -55 394",
    expect: { name: "МБАЛ - Дулово ЕООД", cumulative: 1404214, month: -55394 },
  },
  {
    label: "the merged-column clamp does NOT fire on a negative pair",
    tail: "Болница ЕООД   -100   -50",
    expect: { name: "Болница ЕООД", cumulative: -100, month: -50 },
  },
  {
    label: "a hyphen glued to a name digit is not read as a negative amount",
    tail: "МБАЛ Св. Иван Рилски-2003 ООД                      453 769          453 769",
    expect: {
      name: "МБАЛ Св. Иван Рилски-2003 ООД",
      cumulative: 453769,
      month: 453769,
    },
  },
  {
    label: "a hyphen followed by a space cannot swallow a digit (КОЦ - Бургас)",
    tail: "КОЦ - Бургас ЕООД   16 566   2 454",
    expect: { name: "КОЦ - Бургас ЕООД", cumulative: 16566, month: 2454 },
  },
  {
    // devices 2023-02: the whole national file has month > YTD (5,385,156 vs
    // 5,381,471) because January was negative. Clamping here would zero a real
    // figure on a named hospital — which is why the clamp stays БМП-only.
    label: "lenient stream keeps a positive month that exceeds its own YTD",
    tail: "УМБАЛ Александровска - ЕАД                        43 388            47 073",
    stream: "devices",
    expect: {
      name: "УМБАЛ Александровска - ЕАД",
      cumulative: 43388,
      month: 47073,
    },
  },
  {
    // clean_21082.pdf — the clawback YTD has not been worked off yet but the
    // month is a real +200. `month > cumulative` is trivially true whenever the
    // YTD is negative, so without the clamp's `cumulative >= 0` clause this row's
    // real money is zeroed. Deleting that clause must fail THIS test; the
    // negative-pair case above cannot, because it never reaches the clause.
    label:
      "negative YTD with a positive month keeps the month (clamp needs cumulative >= 0)",
    tail: "ДКЦ Св. София ЕООД                    -10 180                200",
    expect: { name: "ДКЦ Св. София ЕООД", cumulative: -10180, month: 200 },
  },
  {
    // The sign guard is a lookbehind on the MINUS only. Anchoring the whole token
    // would read this as "730" and silently drop €242,730 — the pre-existing
    // glued-name case above is what pins that, and this is its mirror.
    //
    // The hyphen is deliberately LEFT on the name rather than trimmed: a stored
    // name ending in "-" is the fingerprint the corpus gate keys on, so a real row
    // that ever lands in this shape stays visible instead of being tidied away.
    // No cached row does today (0 of 41,495 tails).
    label:
      "an amount welded to a name ending in a hyphen is NOT read as negative",
    tail: "МБАЛ Девин ЕООД-1 500 000   250 000",
    expect: { name: "МБАЛ Девин ЕООД-", cumulative: 1500000, month: 250000 },
  },
  {
    label: "lenient stream reads a negative pair",
    tail: "Болница ЕООД   -100   -50",
    stream: "devices",
    expect: { name: "Болница ЕООД", cumulative: -100, month: -50 },
  },
  {
    // The lenient single-amount branch: month is unknown, recorded 0, never guessed.
    label: "lenient single amount may be negative (month unknown → 0)",
    tail: "Болница ЕООД   -55 394",
    stream: "drugs",
    expect: { name: "Болница ЕООД", cumulative: -55394, month: 0 },
  },
  {
    label: "bmp still refuses a single amount, negative or not",
    tail: "Болница ЕООД   -55 394",
    expect: null,
  },
  // ── RC-4(ii)/(iii), wrapped rows. `pdftotext -layout` emits a wrapped row in
  //    reading order, interleaving the amount columns with the name fragments that
  //    wrapped — and it can cut one amount in half across the break. The candidate
  //    rule assumes the amounts come last, so on these it reads a name fragment:
  //    МИ-МВР-ФИЛИАЛ ВАРНА published €47 against a true €522,872.
  //
  //    All four tails are verbatim. Note the cumulative sits on a DIFFERENT
  //    physical line in each, which is why no column rule can find it — measured,
  //    `-layout` does not preserve the columns for a wrapped row (an ordinary
  //    row's YTD ends at column 118 on bmp 2024-12; this row's at 103).
  {
    label:
      "wrapped — cumulative on the first line, month split across the rest",
    tail:
      "   МИ-МВР-ФИЛИАЛ ВАРНА БОЛНИЦА ЗА ДОЛЕКУВАНЕ, 1 022 653\n" +
      "                       ПРОДЪЛЖИТЕЛНО 91ЛЕЧЕНИЕ\n" +
      "                             063 ИР",
    expect: {
      name: "МИ-МВР-ФИЛИАЛ ВАРНА БОЛНИЦА ЗА ДОЛЕКУВАНЕ,",
      cumulative: 1022653,
      month: 91063,
    },
  },
  {
    // 3-column file (YTD, January, February): the YTD is on L1 and the January
    // column is split across L0 and L2. 57 404 + 31 022 = 88 426 — the row
    // reconciles with itself, which is how the reading was verified.
    //
    // ⚠️ The month is 0 (unknown) even though February's 31 022 IS present and
    // correct. A loose „404" remains after the YTD is taken, and nothing local can
    // tell a stray half („366" out of „45 366") from a whole column — so the row
    // withholds rather than risk publishing half of one. Recovering it needs the
    // column read deferred in extractAmounts' comment.
    label:
      "wrapped — cumulative on the SECOND line, a column split across L0/L2",
    tail:
      "   МИ-МВР-ФИЛИАЛ ВАРНА БОЛНИЦА ЗА ДОЛЕКУВАНЕ,     ПРОДЪЛЖИТЕЛНО 57\n" +
      "                                   88 426    ЛЕЧЕНИЕ\n" +
      "                                        404 И   РЕХАБИЛИТАЦИЯ\n" +
      "                                             31 022",
    expect: {
      name: "МИ-МВР-ФИЛИАЛ ВАРНА БОЛНИЦА ЗА ДОЛЕКУВАНЕ, ПРОДЪЛЖИТЕЛНО 57",
      cumulative: 88426,
      month: 0,
    },
  },
  {
    // The amount itself is cut in half: „…ЕООД279" on L0, „464" on L1, with a
    // name fragment („гр.") between them in reading order. Rejoining is allowed
    // only because neither half carries a separator of its own and the result is
    // one grouped amount — „1 853 500" + „146 500" would also concatenate
    // cleanly, and must not.
    label: "wrapped — the cumulative is split across the line break",
    tail:
      "    ДЪЧМЕД ДИАЛИЗА БЪЛГАРИЯ - ДИАЛИЗЕН ЦЕНТЪР ЕООД279    гр.\n" +
      "464          68 000",
    expect: {
      name: "ДЪЧМЕД ДИАЛИЗА БЪЛГАРИЯ - ДИАЛИЗЕН ЦЕНТЪР ЕООД",
      cumulative: 279464,
      month: 68000,
    },
  },
  {
    // ⚠️ Two COMPLETE amounts side by side must never be rejoined — the guard is
    // that the first fragment carries no separator of its own. Without it this
    // reads 1 853 500 146 500.
    label: "wrapped — two complete amounts are never rejoined",
    tail:
      '   "НефроЛайф България - Специализирани центрове по хемодиализа"ООД\n' +
      "                          1 853 500         146 500",
    expect: {
      name: '"НефроЛайф България - Специализирани центрове по хемодиализа"ООД',
      cumulative: 1853500,
      month: 146500,
    },
  },
  {
    // ⚠️ The shape the review found: on 31 of 33 cached МИ-МВР months the YTD sits
    // BETWEEN the two halves of the split month, so the candidate rule reads the
    // YTD correctly, the reconstruction used to be skipped entirely, and the month
    // published as „366" against a true 45 366 — €1,245,472 across loaded months.
    // Reconciling only the CUMULATIVE against НЗОК's subtotals is blind to it.
    label:
      "wrapped — a month split AROUND the cumulative is withheld, not halved",
    tail:
      "   МИ-МВР-ФИЛИАЛ ВАРНА БОЛНИЦА ЗА ДОЛЕКУВАНЕ,      ПРОДЪЛЖИТЕЛНО 45\n" +
      "                                   133 792     ЛЕЧЕНИЕ\n" +
      "                                        366 И РЕХА",
    expect: {
      name: "МИ-МВР-ФИЛИАЛ ВАРНА БОЛНИЦА ЗА ДОЛЕКУВАНЕ, ПРОДЪЛЖИТЕЛНО 45",
      cumulative: 133792,
      month: 0,
    },
  },
  {
    // ⚠️ "Largest is the YTD" is the clamp's assumption, so it carries the clamp's
    // `!lenient` gate. Without it a WRAPPED УМБАЛ Александровска has its two
    // figures swapped — devices 2023-02 legitimately prints a month above its YTD.
    label: "lenient + wrapped: the two figures are NOT swapped",
    tail:
      "   УМБАЛ Александровска - ЕАД гр. София\n" +
      "                                      43 388            47 073",
    stream: "devices",
    expect: {
      name: "УМБАЛ Александровска - ЕАД гр. София",
      cumulative: 43388,
      month: 47073,
    },
  },
  {
    // ⚠️ A wrapped €0 facility whose name carries a digit would be published at €2
    // and counted as PAID. The reconstruction only overrides above 999.
    label: "wrapped — a zero-payment row is not raised by a name digit",
    tail: "   МБАЛ 2 ЕООД\n                          0            0",
    expect: { name: "МБАЛ 2 ЕООД", cumulative: 0, month: 0 },
  },
];

for (const c of CASES) {
  test(c.label, () => {
    assert.deepEqual(extractAmounts(c.tail, c.stream), c.expect);
  });
}

// ── The header grand-total line. It feeds BOTH completeness asserts, so a
//    regression here does not fail a file — it silently turns the guards off.
//    Every `line` below except the hyphen case is copied VERBATIM out of a cached
//    PDF, gutters included (the hyphen one is synthetic — the corpus has no such
//    rendering, which is the point):
//    the column widths ARE the behaviour under test, so a retyped line tests
//    nothing — a hand-typed 3-column fixture merged all three amounts and made
//    this suite red for the wrong reason before these were pasted from the source.
const TOTAL_CASES: {
  label: string;
  line: string;
  expect: { count: number; cumulative: number; columns: number } | null;
}[] = [
  {
    label: "2-column total (bmp 2026-05)",
    line: "                           381                    Общо РЗОК                                              942 127 532    191 249 510",
    expect: { count: 381, cumulative: 942127532, columns: 2 },
  },
  {
    label: "3-column total takes the FIRST amount, not the last (bmp 2026-02)",
    line: "                          380                    Общо РЗОК                                              368 752 383    182 964 878 185 787 505",
    expect: { count: 380, cumulative: 368752383, columns: 2 },
  },
  {
    label: "lenient label is bare ОБЩО (devices 2026-07)",
    line: "                          112                   ОБЩО                                       51 390 274        6 346 185",
    expect: { count: 112, cumulative: 51390274, columns: 2 },
  },
  {
    // ⚠️ This RENDERING of the line is unreadable, and that is the fact being
    // pinned. drugs 2024-06 prints the two amount columns separated by a SINGLE
    // space on page 1, so the gutter split finds ONE column and the run reads as
    // one 18-digit number. `columns: 1` is the signal the caller uses: the same
    // line is printed with a proper gutter on pages 2-5, and the parser now takes
    // the first occurrence that separated into 2 columns.
    //
    // This case used to pin the 18-digit number as the FILE's header total, with
    // a note saying Tier 1 item 5 would flip it. It did.
    label: "RC-2: a single-space column merge reads as one number (columns: 1)",
    line: "                           43                     ОБЩО                                                    644 030 052 115 383 323",
    expect: {
      count: 43,
      cumulative: Number("644030052115383323"),
      columns: 1,
    },
  },
  {
    // ⚠️ A column that is not a well-formed amount must make the line UNREADABLE,
    // not produce NaN. `Math.abs(NaN) > 0` is false, so a NaN total silently
    // switches the Σ reconciliation assert off while the committed artifact
    // publishes 0 or null for a field typed `number`.
    label: "a hyphen-only column does not yield a NaN total",
    line: "                          43                     ОБЩО                                           -   -",
    expect: null,
  },
  {
    label: "a line that is not a total line yields null",
    line: " 01    Благоевград         1       0103211001   МБАЛ Благоевград АД   4 684 771   903 437",
    expect: null,
  },
  {
    // The SAME figures as the RC-2 case, as printed on pages 2-5 of that file.
    // This is the occurrence the parser now uses, and the pair is the whole fix:
    // one line is unreadable, four are fine, and `columns` tells them apart.
    label: "RC-2: the same total with a proper gutter reads correctly",
    line: "                          43                     ОБЩО                                           644 030 052   115 383 323",
    expect: { count: 43, cumulative: 644030052, columns: 2 },
  },
];

for (const c of TOTAL_CASES) {
  test(`readTotalLine: ${c.label}`, () => {
    assert.deepEqual(readTotalLine(c.line), c.expect);
  });
}

// ── RC-1, the glue. ONE row — Рег.№ 2201211067, Аджибадем Сити Клиник УМБАЛ
//    Токуда, devices — in four different spacings across 40 files. `pdftotext
//    -layout` welds the amount's leading thousands group into the name, so each
//    of these loses exactly one round million; a single pattern covered two of
//    the four and silently missed 12 files.
//
//    Tested at the STRING level on purpose. The repair runs in the parser's
//    `flush()`, before `extractAmounts` ever sees the tail, so a test written
//    against the extractor cannot tell a working repair from a no-op — which is
//    how the two uncovered spacings survived. All five tails are verbatim.
const GLUE_CASES: { label: string; tail: string; expect: string }[] = [
  {
    label:
      "A — digit welded between the name and its fragment (devices 2025-11)",
    tail: "   АДЖИБАДЕМ СИТИ КЛИНИК УМБАЛ ТОКУДА6EАД           735 587           618 585",
    expect:
      "   АДЖИБАДЕМ СИТИ КЛИНИК УМБАЛ ТОКУДА EАД           6 735 587           618 585",
  },
  {
    label: "A — one space before the digit (devices 2026-07)",
    tail: "   АДЖИБАДЕМ СИТИ КЛИНИК УМБАЛ ТОКУДА 2EАД   953 094          295 550",
    expect:
      "   АДЖИБАДЕМ СИТИ КЛИНИК УМБАЛ ТОКУДА EАД   2 953 094          295 550",
  },
  {
    label: "B — digit free, fragment welded to the amount (devices 2024-09)",
    tail: "   АДЖИБАДЕМ СИТИ КЛИНИК УМБАЛ ТОКУДА 4           EАД376 725          589 225",
    expect:
      "   АДЖИБАДЕМ СИТИ КЛИНИК УМБАЛ ТОКУДА EАД 4 376 725          589 225",
  },
  {
    label: "B — digit free, amount wrapped to the next line (devices 2024-11)",
    tail:
      "   АДЖИБАДЕМ СИТИ КЛИНИК УМБАЛ ТОКУДА 5     EАД\n" +
      "                                                     245 651           367 666",
    expect:
      "   АДЖИБАДЕМ СИТИ КЛИНИК УМБАЛ ТОКУДА EАД 5 245 651           367 666",
  },
  // ── The false positives. „ДКЦ 1 Добрич" and „ДКЦ 2 Добрич" are two DIFFERENT
  //    clinics (0828134001 / 0828134002, 90 rows between them) whose real name
  //    digit is free on both sides — structurally indistinguishable from rule B's
  //    target. All three renderings must be refused; the first is the easy one
  //    (no rule can match it), and the WRAPPED two are the ones that decide,
  //    because rule B's regex DOES match them and only the guards refuse them.
  {
    label: "a real name digit is left alone — wide gutter (ДКЦ 1 Добрич)",
    tail: "   ДКЦ 1 Добрич                                         25 382       3 619",
    expect:
      "   ДКЦ 1 Добрич                                         25 382       3 619",
  },
  {
    // Refused by MAX_GLUE_FRAGMENT — „Добрич" is 6 letters — because
    // GROUPED_AMOUNT alone cannot save this one: "1 250 382" IS well-formed.
    // Without the guards this returned { name: "ДКЦ Добрич", cum: 1250382 }.
    label: "a real name digit is left alone — amount wrapped (ДКЦ 1 Добрич)",
    tail: "   ДКЦ 1 Добрич\n                       250 382       3 619",
    expect: "   ДКЦ 1 Добрич\n                       250 382       3 619",
  },
  {
    // The one the review demonstrated against the unguarded function: a
    // fabricated round €2,000,000 — { name: "ДКЦ Добрич", cum: 2905100 } against
    // a true 905,100 — with both clinics merged into one published name.
    label:
      "a real name digit is left alone — wrapped, grouped splice (ДКЦ 2 Добрич)",
    tail: "   ДКЦ 2 Добрич\n                       905 100       40 000",
    expect: "   ДКЦ 2 Добрич\n                       905 100       40 000",
  },
  {
    // GROUPED_AMOUNT's other job: a small amount would otherwise strand the digit
    // in the stored name („ТОКУДАEАД   6 58"), where the corpus gate's
    // amount-in-name fingerprint cannot see it.
    label: "a splice that would not form a grouped amount is refused",
    tail: "   АДЖИБАДЕМ СИТИ КЛИНИК УМБАЛ ТОКУДА6EАД   58   10",
    expect: "   АДЖИБАДЕМ СИТИ КЛИНИК УМБАЛ ТОКУДА6EАД   58   10",
  },
];

for (const c of GLUE_CASES) {
  test(`repairGluedThousands: ${c.label}`, () => {
    assert.equal(repairGluedThousands(c.tail), c.expect);
  });
}

// ── What the repair is FOR: the euro figure it recovers. GLUE_CASES pins the
//    mechanism at string level; this pins the consequence, so a rewrite that
//    produces a differently-spaced but wrong tail cannot pass both. Values
//    verified against НЗОК's own per-РЗОК subtotal for София град.
const GLUE_VALUE_CASES: { label: string; tail: string; cumulative: number }[] =
  [
    {
      label: "A recovers €6,735,587 (devices 2025-11)",
      tail: "   АДЖИБАДЕМ СИТИ КЛИНИК УМБАЛ ТОКУДА6EАД           735 587           618 585",
      cumulative: 6735587,
    },
    {
      label: "A recovers €2,953,094 (devices 2026-07)",
      tail: "   АДЖИБАДЕМ СИТИ КЛИНИК УМБАЛ ТОКУДА 2EАД   953 094          295 550",
      cumulative: 2953094,
    },
    {
      label: "B recovers €4,376,725 (devices 2024-09)",
      tail: "   АДЖИБАДЕМ СИТИ КЛИНИК УМБАЛ ТОКУДА 4           EАД376 725          589 225",
      cumulative: 4376725,
    },
    {
      label: "B recovers €5,245,651 (devices 2024-11)",
      tail:
        "   АДЖИБАДЕМ СИТИ КЛИНИК УМБАЛ ТОКУДА 5     EАД\n" +
        "                                                     245 651           367 666",
      cumulative: 5245651,
    },
  ];

for (const c of GLUE_VALUE_CASES) {
  test(`glue → euro: ${c.label}`, () => {
    const parsed = extractAmounts(repairGluedThousands(c.tail), "devices");
    assert.equal(parsed?.cumulative, c.cumulative);
  });
}

// The two rules run as sequential replaces over one string, so they must not
// co-fire, and a second pass must be a no-op — otherwise a tail satisfying both
// would have its digit moved twice.
test("the glue rules are disjoint and the repair is idempotent", () => {
  for (const c of [...GLUE_CASES, ...GLUE_VALUE_CASES]) {
    const once = repairGluedThousands(c.tail);
    assert.equal(
      repairGluedThousands(once),
      once,
      `not idempotent: ${c.label}`,
    );
  }
});

// ⚠️ A bare run of 5+ digits is a Рег.№ ЛЗ that arrived inside an ABSORBED line,
// not money — these reports space-group every amount above 999.
//
// This tail is now SYNTHETIC: RC-3d fixed the row-matching gap that produced it
// (the ХИПОКРАТ line starts its own row since ROW_START_RE went `\d{1,2}`), so no
// cached file absorbs it any more. Kept because the property must hold for ANY
// future absorption — a Рег.№ leaking into the amount scan published МБАЛ-Девня
// at €156,655,247. Asserted as a property rather than a value: pinning the number
// would read as endorsing the absorption.
test("a registration number in an absorbed line is never read as an amount", () => {
  const r = extractAmounts(
    "   МБАЛ- Девня ЕООД                     255       255\n" +
      " 3     Варна    23   0306391032   ДЦ ХИПОКРАТ ЕООД        4 277       4 277",
  );
  assert.ok(r, "row should still parse");
  assert.ok(
    Math.abs(r.cumulative) < 1_000_000,
    `read ${r.cumulative} — a Рег.№ leaked into the amount scan`,
  );
});

// Two COMPLETE amounts on one line are never fused, even when both are bare
// 3-digit runs and their concatenation is well-formed. The rejoin needs a real
// line break between the halves.
test("two complete same-line amounts are not fused into one", () => {
  const r = extractAmounts(
    "   МБАЛ- Девня ЕООД                     255       255",
  );
  assert.deepEqual(r, {
    name: "МБАЛ- Девня ЕООД",
    cumulative: 255,
    month: 255,
  });
});

// ── RC-3d: the РЗОК code rendered without its leading zero.
//
// One row in the whole cache does it (bmp 2023-01), and under the old `\d{2}`
// row-start it did not begin a row — so it was appended to the PREVIOUS row's
// tail as a wrapped continuation, and МБАЛ-Девня published ХИПОКРАТ's 4,277 BGN
// instead of its own 255 while ДЦ ХИПОКРАТ vanished from the report. The file's Σ
// moved by 255 BGN (0.0001%), far under the reconciliation tolerance, so only the
// facility-count assert ever saw it.
//
// ⚠️ Asserted through the EXPORTED `matchRowStart`, not a locally rebuilt regex.
// The first version of this test rebuilt it, and both halves of the fix survived
// mutation: reverting to `\d{2}` and deleting the `padStart` each left the whole
// file green. Nothing in the repo failed if the fix was reverted.
test("a РЗОК code without its leading zero still starts a row", () => {
  const row = matchRowStart(
    " 3     Варна                 23       0306391032   ДЦ ХИПОКРАТ ЕООД        4 277       4 277",
  );
  assert.ok(row, "the line must start a row");
  assert.equal(row.rzokCode, "03", "the code is padded back to two digits");
  assert.equal(row.rzokName, "Варна");
  assert.equal(row.regNo, "0306391032");
  assert.deepEqual(extractAmounts(row.tail), {
    name: "ДЦ ХИПОКРАТ ЕООД",
    cumulative: 4277,
    month: 4277,
  });
});

// An ordinary two-digit row is unaffected, and — FINDING-002 — the widening must
// not turn a SUBTOTAL, a grand total or a page header into a facility row. None
// carries ten contiguous digits, which is what `\d{10}` requires; these pin that.
test("the widened row-start still refuses every non-facility line", () => {
  assert.equal(
    matchRowStart(
      "                         13                    РЗОК Пазарджик        6 419 791        6 419 791",
    ),
    null,
  );
  assert.equal(
    matchRowStart(
      "                        381                    Общо РЗОК             942 127 532      191 249 510",
    ),
    null,
  );
  assert.equal(
    matchRowStart("РЗОК                     Рег.№ ЛЗ          ЛЗ за БМП"),
    null,
  );
  const ok = matchRowStart(
    " 01    Благоевград         1       0103211001   МБАЛ Благоевград АД   4 684 771   903 437",
  );
  assert.equal(ok?.rzokCode, "01");
  assert.equal(ok?.regNo, "0103211001");
});

// The corpus gate cannot see this. bmp 2023-01 is rejected by the count assert
// under BOTH the old and the new row-start, so its rows never reach the gate's
// fingerprint assertions — its stored name was literally
// "МБАЛ- Девня ЕООД 255 255 3 Варна 23 0306391032 ДЦ ХИПОКРАТ ЕООД", a textbook
// match for the amount-in-name fingerprint, discarded before anything looked. The
// unit seam is the only guard for this class.
test("two rows, one with a short РЗОК code, stay two rows", () => {
  const rows = [
    " 03    Варна   22   0314211005   МБАЛ- Девня ЕООД        255       255",
    " 3     Варна   23   0306391032   ДЦ ХИПОКРАТ ЕООД      4 277     4 277",
  ].map(matchRowStart);
  assert.ok(
    rows.every(Boolean),
    "both lines must start their own row — otherwise the second is absorbed",
  );
  assert.deepEqual(
    rows.map((r) => r?.rzokCode),
    ["03", "03"],
    "both group under one РЗОК",
  );
  for (const r of rows)
    assert.doesNotMatch(
      extractAmounts(r!.tail)!.name,
      /[0-9]{1,3} [0-9]{3}/,
      "an amount leaked into the stored name",
    );
});

// ── RC-2's selection rule: which occurrence of the repeated grand-total line to
//    believe. This IS the whole behaviour change of Tier 1 item 5 — `readTotalLine`
//    reads one line and did not change per-line at all (760 occurrences, 0 moved).
//    Pure, so it is testable without a PDF.
test("the grand total prefers an occurrence whose columns separated", () => {
  // drugs 2024-06: page 1 fuses the two columns, pages 2-5 do not. The fused
  // reading is 3.29e17 and made the drift assert reject a file whose rows agree
  // with the real header to €2.
  const fused = {
    count: 43,
    cumulative: Number("644030052115383323"),
    columns: 1,
  };
  const clean = { count: 43, cumulative: 644030052, columns: 2 };
  assert.deepEqual(pickTotal([fused, clean, clean, clean, clean]), clean);
  assert.deepEqual(pickTotal([clean, fused]), clean, "order must not matter");
});

test("a total whose every occurrence is fused is not silently preferred away", () => {
  // Nothing to fall back to: the first occurrence is returned and the whole-file
  // drift assert then rejects the file loudly, which is the correct failure.
  const fused = {
    count: 43,
    cumulative: Number("644030052115383323"),
    columns: 1,
  };
  assert.deepEqual(pickTotal([fused, fused]), fused);
  assert.equal(pickTotal([]), undefined, "no occurrence at all yields nothing");
});
