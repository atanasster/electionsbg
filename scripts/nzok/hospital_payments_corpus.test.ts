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
  rows: { regNo: string; name: string; cumulativeEur: number }[];
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

const parseAll = (): Parsed[] => {
  const out: Parsed[] = [];
  for (const file of cached()) {
    const p = path.join(RAW, file);
    const res = spawnSync("pdftotext", ["-layout", "-l", "1", p, "-"], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    if (!CACHE_PREFIX.test(file)) continue; // probe / hand-placed, not a fetched report
    if (res.status !== 0 || !res.stdout) continue; // not a readable report
    const m = res.stdout.match(/към\s+\d{1,2}\.(\d{1,2})\.(\d{4})/);
    if (!m || Number(m[2]) < FIRST_YEAR) continue; // out of the loader's scope
    const period = `${m[2]}-${m[1].padStart(2, "0")}`;
    const stream = streamOf(res.stdout.slice(0, 600));
    try {
      const f = parseHospitalPaymentsPdf(p, stream);
      out.push({ file, stream, period, rows: f.rows, rejected: null });
    } catch (e) {
      out.push({
        file,
        stream,
        period,
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
// Not empty yet — Tier 1 item 3 (RC-4 ii/iii, wrapped rows and amounts split
// across the line break) is what empties it:
//   0306253028  МИ-МВР-ФИЛИАЛ ВАРНА — three-line wrapped name
//   1319391019  ДЪЧМЕД ДИАЛИЗА — amount split across the break
//   0306211013  МНОГОПРОФИЛНА БОЛНИЦА ЗА АКТИВНО ЛЕЧЕНИЕ - ВАРНА
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
// Every entry here is a month the site does not have. What closes them:
//   drugs 2024-06                   RC-2  — Tier 1 item 5 (merged header total)
//   the eleven count-assert months  Tier 2 — the per-block reconciliation
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
  "drugs 2024-06",
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
run("every rejection is a completeness assert, never a crash", () => {
  const odd = parsed()
    .filter(
      (f) =>
        f.rejected &&
        !/reconciliation failed|facility-count mismatch/.test(f.rejected),
    )
    .map((f) => `${f.file}: ${f.rejected}`);
  expect(odd, `unexpected parse failures:\n${odd.join("\n")}`).toEqual([]);
});
