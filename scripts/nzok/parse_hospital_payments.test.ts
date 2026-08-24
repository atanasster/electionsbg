// Layout-matrix test for the НЗОК БМП amount extractor — the single most
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
];

for (const c of CASES) {
  test(c.label, () => {
    assert.deepEqual(extractAmounts(c.tail, c.stream), c.expect);
  });
}

// ── The header grand-total line. It feeds BOTH completeness asserts, so a
//    regression here does not fail a file — it silently turns the guards off.
//    Every `line` below is copied VERBATIM out of a cached PDF, gutters included:
//    the column widths ARE the behaviour under test, so a retyped line tests
//    nothing — a hand-typed 3-column fixture merged all three amounts and made
//    this suite red for the wrong reason before these were pasted from the source.
const TOTAL_CASES: {
  label: string;
  line: string;
  expect: { count: number; cumulative: number } | null;
}[] = [
  {
    label: "2-column total (bmp 2026-05)",
    line: "                           381                    Общо РЗОК                                              942 127 532    191 249 510",
    expect: { count: 381, cumulative: 942127532 },
  },
  {
    label: "3-column total takes the FIRST amount, not the last (bmp 2026-02)",
    line: "                          380                    Общо РЗОК                                              368 752 383    182 964 878 185 787 505",
    expect: { count: 380, cumulative: 368752383 },
  },
  {
    label: "lenient label is bare ОБЩО (devices 2026-07)",
    line: "                          112                   ОБЩО                                       51 390 274        6 346 185",
    expect: { count: 112, cumulative: 51390274 },
  },
  {
    // ⚠️ KNOWN-WRONG, pinned deliberately. drugs 2024-06 separates the two amount
    // columns by a SINGLE space, so the run reads as one 18-digit number and the
    // drift assert rejects a file whose rows are correct (Σ €329,287,339 against a
    // true €644,030,052 BGN). This is RC-2 / Tier 1 item 5; when that lands, this
    // expectation must flip to 644030052 and this test going red is the signal.
    label: "RC-2: single-space column merge is misread as one 18-digit number",
    line: "                           43                     ОБЩО                                                    644 030 052 115 383 323",
    // Built from the string rather than written as a literal: 18 digits exceed
    // Number.MAX_SAFE_INTEGER, so the literal would lose precision — which is
    // the defect itself, and is also what `no-loss-of-precision` objects to.
    expect: { count: 43, cumulative: Number("644030052115383323") },
  },
  {
    label: "a line that is not a total line yields null",
    line: " 01    Благоевград         1       0103211001   МБАЛ Благоевград АД   4 684 771   903 437",
    expect: null,
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
