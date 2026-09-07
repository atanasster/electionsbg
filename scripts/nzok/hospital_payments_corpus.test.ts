// Whole-corpus gate for the НЗОК hospital-payment parser — the guarantee the
// unit matrix next door cannot give.
//
// `parse_hospital_payments.test.ts` locks `extractAmounts` against hand-picked
// tails. Every defect in docs/plans/nzok-hospital-parser-hardening-v1.md lived in
// the row/block ASSEMBLY around it and was invisible to that file — including one
// it should have caught, since the matrix already carried a glued-name case and
// still missed four more spacings of the same shape. This test runs the real
// parser over every cached PDF instead, and asserts on FINGERPRINTS of a misparse
// rather than on values, so it stays true as the corpus grows.
//
// It reads `raw_data/nzok/bmp/` (gitignored — the loader's download cache) and
// SKIPS when that is absent, the same bargain the `scripts/db/tests/*.data.test.ts`
// gates strike with Postgres: a fresh clone stays green, a machine that has run
// the loader gets the real check. ~48 s over ~170 files (the parse is shared across
// all four tests; pdftotext dominates), inside the node project's 120 s budget.

import { test, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  parseHospitalPaymentsPdf,
  type CountMismatch,
  type PaymentStream,
} from "./parse_hospital_payments";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const RAW = path.join(REPO, "raw_data/nzok/bmp");

/** The cache is keyed by a hash of the source URL, so the stream is not
 *  recoverable from the filename — read it off the report's own title. Order
 *  matters: the МИ and ЛП titles both contain "болничната медицинска помощ", so
 *  бмп can only be the fallback. */
const streamOf = (head: string): PaymentStream =>
  /медицински изделия|средства за МИ/iu.test(head)
    ? "devices"
    : /лекарствени продукти|средства за ЛП|лек_прод/iu.test(head)
      ? "drugs"
      : "bmp";

interface Parsed {
  file: string;
  stream: PaymentStream;
  /** "YYYY-MM", read off the report's own „към DD.MM.YYYY" title. Available even
   *  when the parse throws, which is what lets a rejection be identified by the
   *  MONTH it withholds rather than by which cache file happened to hold it. */
  period: string;
  /** Blocks the parser could not block-reconcile (НЗОК printed no subtotal). */
  unreconciled: string[];
  /** Blocks whose printed count disagrees with the ordinals actually seen. */
  countMismatches: CountMismatch[];
  /** Needed by the block reconciliation below: the subtotal lines live in the raw
   *  text, and the peg conversion needs to know which currency the file is in. */
  text: string;
  currency: "BGN" | "EUR";
  rows: {
    regNo: string;
    name: string;
    rzokName: string;
    cumulativeEur: number;
    monthEur: number;
  }[];
  rejected: string | null;
}

/** The scope is the loader's, not the directory's. `raw_data/nzok/bmp/` also holds
 *  `probe_*.pdf` files and a handful of ≤2022 reports kept from backfill attempts.
 *
 *  ⚠️ A year filter alone does NOT exclude the probes — `probe_2023/2024/2025`
 *  carry a 2023+ „към" date and two of them were contributing to the fingerprint
 *  counts below. The honest discriminator is the loader's own cache-key prefix:
 *  `fetchToCache` writes every file it fetches as `clean_<hash>.pdf`, so anything
 *  else in this directory is something a human put there. */
const CACHE_PREFIX = /^clean_[0-9a-f]+\.pdf$/;
const FIRST_YEAR = 2023;

/** The cache is a machine-local download cache, so "it has some PDFs in it" is not
 *  the same as "it is usable". Below this many in-scope reports the assertions
 *  below would be measuring an interrupted download rather than the parser, so the
 *  file skips instead — a red gate that says "new defect" and means "different
 *  cache" is worse than no gate. Today's cache holds ~165. */
const MIN_USABLE = 100;

const cached = (): string[] =>
  fs.existsSync(RAW)
    ? fs
        .readdirSync(RAW)
        .filter((f) => CACHE_PREFIX.test(f))
        .sort()
    : [];

/** The full text, not just page 1 — the per-РЗОК subtotal lines are spread through
 *  the document. Page 1 alone is enough for the title and period sniff above. */
const full = (p: string): string =>
  spawnSync("pdftotext", ["-layout", p, "-"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).stdout ?? "";

const parseAll = (): Parsed[] => {
  const out: Parsed[] = [];
  for (const file of cached()) {
    const p = path.join(RAW, file);
    const res = spawnSync("pdftotext", ["-layout", "-l", "1", p, "-"], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    if (res.status !== 0 || !res.stdout) continue; // not a readable report
    const m = res.stdout.match(/към\s+\d{1,2}\.(\d{1,2})\.(\d{4})/);
    if (!m || Number(m[2]) < FIRST_YEAR) continue; // out of the loader's scope
    const period = `${m[2]}-${m[1].padStart(2, "0")}`;
    const stream = streamOf(res.stdout.slice(0, 600));
    try {
      const f = parseHospitalPaymentsPdf(p, stream);
      out.push({
        file,
        stream,
        period,
        text: full(p),
        currency: f.currencyOfRecord,
        unreconciled: f.unreconciledBlocks,
        countMismatches: f.countMismatches,
        rows: f.rows,
        rejected: null,
      });
    } catch (e) {
      out.push({
        file,
        stream,
        period,
        text: "",
        currency: "BGN",
        unreconciled: [],
        countMismatches: [],
        rows: [],
        rejected: (e as Error).message,
      });
    }
  }
  return out;
};

const FILES = cached();
const run = FILES.length >= MIN_USABLE ? test : test.skip;
if (FILES.length < MIN_USABLE)
  console.warn(
    `[nzok corpus] only ${FILES.length} cached reports (need ${MIN_USABLE}) — skipping. ` +
      "Run `npm run db:load:nzok-hospital:pg` to populate raw_data/nzok/bmp.",
  );

// Parsed once and shared: 176 spawns of pdftotext is the whole cost of this file.
let PARSED: Parsed[] | null = null;
const parsed = (): Parsed[] => (PARSED ??= parseAll());

/** ⚠ THE PARSE IS BILLED TO A HOOK, NOT TO WHICHEVER TEST TOUCHES IT FIRST.
 *
 *  It used to be purely lazy, so the 176 `pdftotext` spawns were charged to the first
 *  assertion that called `parsed()` — „no parsed facility name ends in a stray sign" — against
 *  the node project's 120 s per-TEST timeout. Measured 2026-09-07 on an idle machine: the file
 *  takes 72.7 s end to end, essentially all of it here. That is 47 s of headroom, and vitest
 *  runs ~16 workers over CPU-bound subprocesses, so a full `npm run test:unit` loses it: the
 *  run that prompted this failed at exactly that assertion with „Test timed out in 120000ms".
 *
 *  Two things change. The cost lands in a hook, so a slow parse now reports itself as a slow
 *  SETUP rather than as a failing claim about hyphens — the old message named an assertion that
 *  was never evaluated. And the budget is stated where the cost is, sized at ~4x the measured
 *  idle time so contention has somewhere to go while the run stays bounded.
 *
 *  ⚠ IT STAYS MEMOISED. The hook fills the same cache the lazy accessor reads, so a future test
 *  added to this file cannot re-spawn 176 processes by calling `parsed()` — and the accessor
 *  keeps working if this hook is ever removed. */
const PARSE_BUDGET_MS = 300_000;
beforeAll(() => {
  // Nothing to parse when the cached corpus is short — the tests are skipped anyway, and
  // spawning the parse here would make a skipped file the slowest one in the suite.
  if (FILES.length >= MIN_USABLE) parsed();
}, PARSE_BUDGET_MS);

// ─────────────────────────────────────────────────────────────────────────────
// Fingerprint 1 — a swallowed minus sign. HARD ZERO.
//
// The unsigned reader could not see a leading "-", so it took the digits as a
// positive amount and left the sign in the NAME: „ДКЦ Св. София ЕООД -" was
// published as having RECEIVED €5,205 that НЗОК had in fact clawed back, for six
// consecutive months. The stored name ending in "-" was the only visible trace,
// which is exactly what makes it a good fingerprint.
//
// This is zero and must stay zero — there is no legitimate reason for a facility
// name to end in a hyphen, and if the RC-1 glue mechanism ever welds an amount
// onto a name that does, this is the assertion that says so.
run("no parsed facility name ends in a stray sign", () => {
  const hits = parsed().flatMap((f) =>
    f.rows
      .filter((r) => /-$/.test(r.name))
      .map((r) => `${f.stream} ${f.file} ${r.regNo} ${JSON.stringify(r.name)}`),
  );
  expect(hits, `names ending in "-":\n${hits.join("\n")}`).toEqual([]);
});

// ─────────────────────────────────────────────────────────────────────────────
// Fingerprint 2 — an AMOUNT captured into the name.
//
// „МИ-МВР-ФИЛИАЛ ВАРНА БОЛНИЦА ЗА ДОЛЕКУВАНЕ, 1 022 653 ПРОДЪЛЖИТЕЛНО" is a
// stored facility name, and the row it belongs to carries €47 against a true
// €522,872. Wherever a thousands-grouped run survives inside a name, that row's
// amount extraction went somewhere else.
//
// ⚠️ Asserted as an IDENTITY SET, not a count. A count over this directory is a
// count over a machine-local download cache that grows every time НЗОК publishes
// a month — so each new December re-renders the same МИ-МВР row and turns the
// gate red on `db:load:nzok-hospital:pg` rather than on a commit. The set of
// FACILITIES affected is the stable fact; a new month with the same defect adds
// nothing, and a new kind of failure names itself.
//
// ⚠️ Tier 1 item 3 (RC-4 ii/iii) fixed the MONEY on every one of these rows —
// verified against НЗОК's own per-РЗОК subtotals, which now disagree on nothing
// but bmp 2023-01 — and did NOT empty this set. The three facilities still carry
// an amount inside the stored NAME on 8 rows, because the name is bounded by
// where the cumulative was found and a wrapped row leaves fragments on both
// sides of it. That is a presentation defect on a published facility name, not a
// euro one, and it is deliberately left rather than papered over: the fingerprint
// is the only thing that keeps these rows visible.
//   0306253028  МИ-МВР-ФИЛИАЛ ВАРНА — name wraps across three physical lines
//   1319391019  ДЪЧМЕД ДИАЛИЗА — amount welded to „ЕООД", name continues after it
//   0306211013  МНОГОПРОФИЛНА БОЛНИЦА ЗА АКТИВНО ЛЕЧЕНИЕ - ВАРНА (single-line glue)
const AMOUNT_IN_NAME_REGNOS = ["0306211013", "0306253028", "1319391019"];

run("only the known facilities carry an amount inside their name", () => {
  const hits = [
    ...new Set(
      parsed().flatMap((f) =>
        f.rows
          .filter((r) => /\d{1,3}[ \u00a0]\d{3}/.test(r.name))
          .map((r) => r.regNo),
      ),
    ),
  ].sort();
  expect(hits).toEqual(AMOUNT_IN_NAME_REGNOS);
});

// ─────────────────────────────────────────────────────────────────────────────
// Fingerprint 3 — the months the parser withholds.
//
// A rejected month is a month ABSENT from nzok_hospital_payments: the loader
// catches the throw, logs one truncated line and carries on at exit 0. That is
// why this belongs in a test rather than in a console.
//
// ⚠️ It is now EMPTY, and that is Tier 2's whole point rather than a gate going
// slack. 24 of 127 files were withheld when this work started — 14 for money and
// 10 over a count that means different things in different eras. Tier 1 fixed the
// money; Tier 2 replaced the count ASSERT with a count REPORT, because no rule
// can tell НЗОК's own bookkeeping from a real drop by counting. The strong check
// is the per-block reconciliation, which the parser now performs and which this
// file re-performs independently below.
//
// A NEW entry here is a real regression: it means a file that used to publish
// stopped, and the message says which of the four asserts fired.
const REJECTED_PERIODS: string[] = [];

run("no month is withheld", () => {
  const rejected = [
    ...new Set(
      parsed()
        .filter((f) => f.rejected)
        .map((f) => `${f.stream} ${f.period}: ${f.rejected}`),
    ),
  ].sort();
  expect(rejected.map((r) => r.split(":")[0])).toEqual(REJECTED_PERIODS);
});

// ─────────────────────────────────────────────────────────────────────────────
// Fingerprint 4 — blocks whose printed count and „№ по ред" ordinals disagree.
//
// This REPLACES the old facility-count assert, and the difference is what makes
// it usable: the assert said "364 paid vs a header of 373" about a whole file,
// which is a discrepancy; this says „Бургас printed 27, ordinal 5 is absent",
// which is a fact about one facility. Every entry below is НЗОК's own bookkeeping
// — a count of rows it did not print, or (devices 2023-06/07) София град's count
// given as 83, which is the БМП report's Sofia figure and not this report's 27.
//
// Asserted as an identity set for the same reason as the others: a new KIND of
// disagreement names itself, while a new month with a known one adds no noise.
// ⚠️ Keyed on (stream, BLOCK), not (stream, period). The mechanism is per-block
// and RECURS: НЗОК's January files count facilities they do not print, so 6 of the
// 13 affected months are Januaries and a period-keyed set turns red every January
// on an ordinary cache refresh — the trap this file's own fingerprint-2 comment
// documents. A block-keyed set absorbs the next January silently and still names a
// NEW region the day one appears.
const COUNT_MISMATCH_BLOCKS = [
  "bmp Бургас",
  "bmp Кюстендил",
  "bmp Пазарджик",
  "bmp Плевен",
  "bmp Русе",
  "bmp София град",
  "devices Бургас",
  "devices Варна",
  "devices Пазарджик",
  "devices Пловдив",
  "devices Сливен",
  "devices София град",
  "devices Стара Загора",
  "drugs Русе",
  "drugs София град",
  "drugs Хасково",
  "drugs Шумен",
];

run("only the known blocks disagree with their printed count", () => {
  const mismatched = [
    ...new Set(
      parsed().flatMap((f) =>
        f.countMismatches.map((m) => `${f.stream} ${m.block}`),
      ),
    ),
  ].sort();
  expect(mismatched).toEqual(COUNT_MISMATCH_BLOCKS);
});

// ⚠️ The ordinal capture, asserted directly. An earlier test here claimed to catch
// it breaking and could not: it asserted that every mismatch names an absent
// ordinal, which the report's own emit condition makes unfalsifiable. If the
// capture broke, EVERY row would read as unnumbered — so assert the opposite from
// the data side, where it is a real measurement.
run("the row ordinal is actually being captured across the corpus", () => {
  const files = parsed().filter((f) => !f.rejected);
  const unnumbered = files.reduce(
    (n, f) => n + f.countMismatches.reduce((m, c) => m + c.unnumbered, 0),
    0,
  );
  const numbered = files.reduce(
    (n, f) => n + f.countMismatches.reduce((m, c) => m + c.numbered, 0),
    0,
  );
  expect(
    numbered,
    "no ordinals seen at all — the capture group has broken",
  ).toBeGreaterThan(0);
  expect(
    numbered,
    `ordinals collapsed: ${numbered} numbered against ${unnumbered} unnumbered`,
  ).toBeGreaterThan(unnumbered);
});

run("every rejection is a completeness assert, never a crash", () => {
  const odd = parsed()
    .filter(
      (f) =>
        f.rejected &&
        // Every assert the parser can throw, by message. A NEW one must be added
        // here or it reports as a crash — which is exactly what happened to
        // "header total disagrees with its own blocks" before this was updated,
        // and it is the one distinction this test exists to draw.
        !/reconciliation failed|facility-count mismatch|header total disagrees|unreadable grand-total line/.test(
          f.rejected,
        ),
    )
    .map((f) => `${f.file}: ${f.rejected}`);
  expect(odd, `unexpected parse failures:\n${odd.join("\n")}`).toEqual([]);
});

// ─────────────────────────────────────────────────────────────────────────────
// The reconciliation the fingerprints cannot do.
//
// Every fingerprint above asks "does this row LOOK misparsed". None of them asks
// "does the money ADD UP", and that is the check that actually decides. НЗОК
// prints its own subtotal above each РЗОК block — count, year-to-date and month —
// so each block is an independent statement of what the rows beneath it must sum
// to, and it is the only ground truth available offline.
//
// ⚠️ Both arms, deliberately. The first cut of the wrapped-row work reconciled the
// CUMULATIVE only, called it verified, and shipped a MONTH that published „366"
// against a true 45 366 on 31 files — €1,245,472. A one-armed reconciliation is
// how that passed.
//
// ⚠️ DUPLICATED ON PURPOSE. The parser performs this reconciliation too, and the
// two copies are the point rather than an oversight — see below.
//
// ⚠️ Since Tier 2 the PARSER performs this reconciliation too and throws on a
// block that does not balance, so a file that fails it never reaches here — and
// the YTD arm below is, for every ACCEPTED file, mathematically implied. Stating
// that plainly rather than defending it: it is kept for one specific failure it
// can still see, and the MONTH arm is the honest reason this file earns its keep.
//
// What the YTD arm still catches: the parser's subtotal matching silently finding
// FEWER blocks. Its assert would then pass over a smaller set while this file's
// independent regex still finds them — the `unreconciledBlocks` field reports the
// same thing from inside, but only for blocks that HAVE rows.
//
// What it does NOT have, contrary to an earlier draft of this note: its own
// grouping. The `got` side groups on the parser's own `rzokName`, so a
// mis-captured region name moves rows on both sides together and neither notices.

/** Every amount on a block subtotal line: count, then YTD, then one column per
 *  reporting month (a 3-column file carries two). */
const SUBTOTAL =
  /^\s*(\d+)\s+РЗОК\s+(\S.*?)\s{2,}((?:-?[\d \u00a0]+\s{2,})*-?[\d \u00a0]+)\s*$/;
// The locked BGN/EUR rate. Restated here rather than imported because the parser
// converts through `toEur` in src/lib/currency and this test must be able to
// DISAGREE with it — a gate that shares its constant with the code under test
// cannot notice the constant changing.
const PEG = 1.95583;

interface Block {
  file: string;
  stream: PaymentStream;
  period: string;
  rzok: string;
  subCum: number;
  subMonth: number;
  gotCum: number;
  gotMonth: number;
  rows: number;
}

const blocks = (): Block[] => {
  const out: Block[] = [];
  for (const f of parsed()) {
    if (f.rejected) continue; // a withheld month publishes nothing to reconcile
    const eur = f.currency === "EUR";
    const conv = (x: string) => {
      const n = Number(x.replace(/[\s\u00a0]/g, ""));
      return eur ? n : Math.round(n / PEG);
    };
    const subs = new Map<string, { cum: number; month: number }>();
    for (const line of f.text.split(/\r?\n/)) {
      const m = line.match(SUBTOTAL);
      if (!m || subs.has(m[2].trim())) continue;
      const cols = m[3]
        .split(/\s{2,}/)
        .map((c) => c.trim())
        .filter(Boolean);
      subs.set(m[2].trim(), {
        cum: conv(cols[0]),
        // The FIRST month column, which is what `monthEur` carries — a 3-column
        // file prints two and the parser has always taken the earlier one.
        month: conv(cols[1] ?? cols[cols.length - 1]),
      });
    }
    const got = new Map<string, { cum: number; month: number; n: number }>();
    for (const r of f.rows) {
      const c = got.get(r.rzokName) ?? { cum: 0, month: 0, n: 0 };
      c.cum += r.cumulativeEur;
      c.month += r.monthEur;
      c.n++;
      got.set(r.rzokName, c);
    }
    for (const [rzok, sub] of subs) {
      const g = got.get(rzok) ?? { cum: 0, month: 0, n: 0 };
      out.push({
        file: f.file,
        stream: f.stream,
        period: f.period,
        rzok,
        subCum: sub.cum,
        subMonth: sub.month,
        gotCum: g.cum,
        gotMonth: g.month,
        rows: g.n,
      });
    }
  }
  return out;
};

/** Deliberately RESTATED rather than importing `blockTolerance`, for the same
 *  reason as PEG above: a gate that shares its band with the code under test
 *  cannot notice the band changing.
 *
 *  Each row is rounded to the euro independently and the subtotal is rounded once,
 *  so a block of n rows may legitimately differ by a few euro. Re-measured after
 *  Tier 1 across 3,700 blocks the rounding band tops out at €6, and the smallest
 *  REAL defect ever found here was €129. `max(10, rows)` sits in that gap with
 *  slack on both sides. */
const tolerance = (rows: number) => Math.max(10, rows);

run(
  "every published block's year-to-date reconciles to НЗОК's own subtotal",
  () => {
    const off = blocks()
      .filter((b) => Math.abs(b.subCum - b.gotCum) > tolerance(b.rows))
      .map(
        (b) =>
          `${b.stream} ${b.period} ${b.rzok}: НЗОК €${b.subCum.toLocaleString()} vs parsed €${b.gotCum.toLocaleString()}`,
      );
    expect(
      off,
      `blocks whose YTD does not reconcile:\n${off.join("\n")}`,
    ).toEqual([]);
  },
);

// The month arm is ONE-SIDED on purpose. A wrapped row whose month column was cut
// in half around the year-to-date records 0 ("unknown") rather than publishing a
// fragment, so a block's month sum is legitimately SHORT — 33 files, and that
// under-reporting is the fix, not the defect. What must never happen is the other
// direction: a block that publishes MORE month money than НЗОК says it paid can
// only mean a figure was invented or double-counted.
run(
  "no published block overstates its month against НЗОК's own subtotal",
  () => {
    const over = blocks()
      .filter((b) => b.gotMonth - b.subMonth > tolerance(b.rows))
      .map(
        (b) =>
          `${b.stream} ${b.period} ${b.rzok}: parsed €${b.gotMonth.toLocaleString()} vs НЗОК €${b.subMonth.toLocaleString()}`,
      );
    expect(over, `blocks overstating the month:\n${over.join("\n")}`).toEqual(
      [],
    );
  },
);

// ⚠️ The `covered` guard's own regression is otherwise uncovered: it turns the
// whole-file cross-check OFF for a file whose blocks are only partly printed, and
// a bug that turned it off for EVERY file would look identical from outside. So
// pin both halves — that partial coverage is ACCEPTED (the file's data is fine;
// drugs 2023-03's Σ matches its header to the euro), and that it stays confined
// to the one file that actually does this.
const PARTIAL_COVERAGE = ["drugs 2023-03"];

run("only the known file loads with partial block coverage", () => {
  const partial = parsed()
    .filter((f) => !f.rejected && f.unreconciled.length)
    .map((f) => `${f.stream} ${f.period}`)
    .sort();
  expect(
    [...new Set(partial)],
    "a file whose blocks stopped printing subtotals — or a regression that " +
      "disabled the coverage check everywhere",
  ).toEqual(PARTIAL_COVERAGE);
});
