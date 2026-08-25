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

import { test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  parseHospitalPaymentsPdf,
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
// Fingerprint 3 — the months the completeness asserts withhold.
//
// A rejected month is a month ABSENT from nzok_hospital_payments: the loader
// catches the throw, logs one truncated line and carries on at exit 0. That is
// why this belongs in a test rather than in a console.
//
// ⚠️ Identity, not a count, and keyed on (stream, PERIOD) rather than on cache
// files — a superseded re-upload of a bad month is the same missing month, and
// counting it twice made this number 17 where the site is missing 12.
//
// Every entry here is a month the site does not have, and every one of them is
// now a COUNT-assert failure — Tier 1 closed the whole Σ-drift class, including
// drugs 2024-06, whose rows were always right and whose header alone was misread
// (RC-2). What is left is the count model itself, which is Tier 2's per-block
// reconciliation: НЗОК's own printed count means different things in different
// eras, and on some months it counts facilities it does not print.
const REJECTED_PERIODS = [
  "bmp 2023-01",
  "bmp 2023-02",
  "bmp 2023-03",
  "bmp 2025-01",
  "bmp 2026-01",
  "devices 2023-06",
  "devices 2023-07",
  "devices 2025-01",
  "devices 2026-01",
  "drugs 2023-06",
  "drugs 2023-07",
];

run("only the known months are withheld", () => {
  const rejected = [
    ...new Set(
      parsed()
        .filter((f) => f.rejected)
        .map((f) => `${f.stream} ${f.period}`),
    ),
  ].sort();
  expect(rejected).toEqual(REJECTED_PERIODS);
});

// A rejection is only ever one of the two completeness asserts. Anything else —
// a TypeError, a pdftotext failure, a regex blowing up on a new layout — is a
// crash wearing a rejection's clothes, and the ratchet above would absorb it.
// The comment on REJECTED_PERIODS says every remaining rejection is a COUNT
// failure — Tier 1 closed the whole Σ-drift class. Asserted rather than claimed:
// a Σ-drift rejection reappearing means a money defect came back, which is a very
// different event from a count-model month and must not hide among them.
run("every remaining rejection is a count failure, not a money one", () => {
  // ⚠️ `/reconciliation failed/` alone is wrong now: Tier 2 added
  // "block reconciliation failed for …", which that pattern absorbs — so a BLOCK
  // failure would be announced as the whole-file ratio returning, naming the
  // backstop instead of the check that actually fired.
  const drift = parsed()
    .filter(
      (f) =>
        f.rejected &&
        /block reconciliation failed|header total disagrees|(?<!block )reconciliation failed/.test(
          f.rejected,
        ),
    )
    .map((f) => `${f.stream} ${f.period}: ${f.rejected}`);
  expect(
    drift,
    `Σ-drift rejections have returned:\n${drift.join("\n")}`,
  ).toEqual([]);
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
