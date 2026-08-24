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
// the loader gets the real check. ~17 s over 176 files, inside the node project's
// 120 s budget.

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
  rows: { regNo: string; name: string; cumulativeEur: number }[];
  rejected: string | null;
}

/** The scope is the loader's, not the directory's. `raw_data/nzok/bmp/` also holds
 *  a `probe_*.pdf` and a handful of ≤2022 files kept from backfill attempts; the
 *  loader's `YEARS` is 2023-2026 and the ≤2022 era is a documented, unhardened
 *  naming/format shift (scripts/nzok/README.md). Judging the parser on files it
 *  does not claim to read would make this gate fail for a reason that is not a
 *  defect — so a file earns its way in by carrying a "към DD.MM.YYYY" period of
 *  2023 or later, which is exactly the set the loader would attempt. It is WIDER
 *  than the 127 links the listing pages currently offer (172 files), because
 *  superseded re-uploads stay in the cache and are perfectly good reports. */
const FIRST_YEAR = 2023;

const cached = (): string[] =>
  fs.existsSync(RAW)
    ? fs
        .readdirSync(RAW)
        .filter((f) => f.endsWith(".pdf"))
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
    if (res.status !== 0 || !res.stdout) continue; // not a readable report
    const period = res.stdout.match(/към\s+\d{1,2}\.\d{1,2}\.(\d{4})/);
    if (!period || Number(period[1]) < FIRST_YEAR) continue; // out of the loader's scope
    const stream = streamOf(res.stdout.slice(0, 600));
    try {
      const f = parseHospitalPaymentsPdf(p, stream);
      out.push({ file, stream, rows: f.rows, rejected: null });
    } catch (e) {
      out.push({ file, stream, rows: [], rejected: (e as Error).message });
    }
  }
  return out;
};

const FILES = cached();
const run = FILES.length ? test : test.skip;
if (!FILES.length)
  console.warn(
    "[nzok corpus] raw_data/nzok/bmp is empty — skipping. Run `npm run db:load:nzok-hospital:pg` to populate it.",
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
// Fingerprint 2 — an AMOUNT captured into the name. RATCHET.
//
// „МИ-МВР-ФИЛИАЛ ВАРНА БОЛНИЦА ЗА ДОЛЕКУВАНЕ, 1 022 653 ПРОДЪЛЖИТЕЛНО" is a
// stored facility name, and the row it belongs to carries €47 against a true
// €522,872. Wherever a thousands-grouped run survives inside a name, the row's
// amount extraction went somewhere else.
//
// Counted over the cache (172 in-scope files), so a defect present in both a file
// and its superseded re-upload counts twice — see the note on REJECTED below.
//
// ⚠️ This is a RATCHET, asserted by EQUALITY rather than "≤", so a step that
// improves the parser has to come here and lower the number — which puts the
// improvement in the diff instead of leaving a slack ceiling that quietly absorbs
// a future regression. It is NOT zero yet:
//
//   Tier 1 item 2 (RC-1, the four Токуда glue spacings)  — open
//   Tier 1 item 3 (RC-4 ii/iii, wrapped rows / split amounts) — open
//
// Both are in docs/plans/nzok-hospital-parser-hardening-v1.md. When they land
// this expectation becomes 0 and the ratchet is retired into a hard zero.
const AMOUNT_IN_NAME = 14;

run("an amount captured into a facility name stays at its known count", () => {
  const hits = parsed().flatMap((f) =>
    f.rows
      // Escaped rather than literal: an NBSP in source is invisible, which is
      // how repairGluedThousands ended up with a plain space written twice.
      .filter((r) => /\d{1,3}[ \u00a0]\d{3}/.test(r.name))
      .map((r) => `${f.stream} ${f.file} ${r.regNo} ${JSON.stringify(r.name)}`),
  );
  expect(
    hits.length,
    `amount-in-name rows (expected ${AMOUNT_IN_NAME}):\n${hits.join("\n")}`,
  ).toBe(AMOUNT_IN_NAME);
});

// ─────────────────────────────────────────────────────────────────────────────
// Fingerprint 3 — files the completeness asserts reject. RATCHET.
//
// A rejected month is a month ABSENT from nzok_hospital_payments: the loader
// catches the throw, logs one truncated line and carries on at exit 0. That is
// why this number belongs in a test rather than in a console — the loader
// currently withholds 24 of the 127 (stream, period) files the listing pages
// offer, the devices stream alone is missing 16 months, and nothing fails.
//
// ⚠️ The number here is 29, not 24, and the two are not in conflict: this walks
// the CACHE (172 in-scope files) rather than the current links, so a superseded
// re-upload carrying the same defect is counted again. Read 29 as "files on
// disk", 24 as "months the site is missing" — quoting either as the other is the
// mistake this note exists to prevent.
//
// Equality again, for the same reason as above. Tier 1 recovers most of these and
// Tier 2 the rest; a NEW rejection appearing here is a new defect, not noise.
const REJECTED = 29;

run("the parser rejects only its known-bad files", () => {
  const rejected = parsed()
    .filter((f) => f.rejected)
    .map(
      (f) => `${f.stream} ${f.file}: ${f.rejected?.split(":").pop()?.trim()}`,
    )
    .sort();
  expect(
    rejected.length,
    `rejected files (expected ${REJECTED}):\n${rejected.join("\n")}`,
  ).toBe(REJECTED);
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
