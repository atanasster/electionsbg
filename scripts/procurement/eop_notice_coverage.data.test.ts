// The measured coverage gate plan A5 asks for.
//
// WHY IT EXISTS. The hand-written fixtures in eop_notice_parse.test.ts assert that
// the parser handles shapes I wrote; this asserts it handles the shapes the REGISTER
// actually emits. Both of the parser's shipped defects were invisible to the unit
// tests and obvious here: `BT-36-Lot` carries a bare number (the fixtures claimed
// "24 Месец", which occurs in zero notices), and 16.6% of pairs carried a
// parenthesised code the first regex silently demoted to the legacy tier. (That
// 16.6% is the 2026-08-10 capture and is NOT the corpus today: re-measured
// 2026-08-25 it is 74,615 of 11,248,485 pairs, 0.66%, because the crawl has since
// filled in the legacy era, which emits no BT codes at all. The defect it names is
// unchanged — only the share moved.)
//
// Reads the captured tier-A store, so it skips on a machine that has not crawled —
// same convention as the Postgres data tests.
//
// ⚠️⚠️ IT MUST NEVER MATERIALISE THE CORPUS, AND THAT IS THE WHOLE REASON THIS FILE
// LOOKS THE WAY IT DOES. The first cut ran one `SELECT body_gz … WHERE kind =
// 'details'` through `.all()` and kept every decoded `HtmlPreview` plus every parsed
// pair alive in two module-level arrays. That is the exact defect
// `EopDossierStore.iterate()`'s own docstring was written about — and it does not
// fail as a red test. `.all()` OOMs the Vitest worker during COLLECTION, so the
// process dies before a single assertion runs and the suite summary reads
// `Test Files 30 passed (31)` with one "Worker exited unexpectedly" error below it,
// which scans as green. Measured 2026-08-25: 50,468 `details` rows, 1.53 GB gzipped
// and **17.8 GB decoded**, killing the worker at the 3.8 GB default heap 28 s in.
//
// It also DEGRADED SILENTLY WITH THE CRAWL rather than breaking on some commit. This
// file landed 2026-08-10 (7f3228a1a8), when the capture was small enough to fit —
// CLAUDE.md records the dossier corpus at 1,861 procedures two days later — and it
// holds 50,468 now. So the gate ran, then stopped running, and no commit sits at the
// boundary to blame: a data gate that never looks, which is what
// `kzk_appeals_provenance.data.test.ts`'s header means by "a floor that never moves
// cannot tell healthy from frozen". Hence the sampled default below: a gate whose
// cost grows with the corpus is a gate with an expiry date.
//
// So: read through the store's keyset-paged `iterate()` / point `getJson()`, and
// accumulate COUNTERS plus a handful of bounded example strings. Nothing derived
// from a notice outlives the loop iteration that produced it. Measured 2026-08-25:
// 38 MB heap on the sampled default and 79 MB peak on the full 17.8 GB walk, against
// the 3.8 GB the old shape had already exhausted when it died.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { EopDossierStore } from "./eop_dossier_store";
import { strideSample } from "./eop_coverage_sample";
import {
  parseNoticePairs,
  noticeFields,
  isPriceOnly,
} from "./eop_notice_parse";

const STORE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../raw_data/procurement/eop_dossier.sqlite",
);

/** Walk every stored dossier instead of a sample. ~4 min and ~17.8 GB of streamed
 *  JSON, so it is opt-in: `EOP_COVERAGE_FULL=1 npx vitest run …`. */
const FULL = process.env.EOP_COVERAGE_FULL === "1";

/** Dossiers sampled in the default mode. 2,000 costs ~12 s and yields ~8,800
 *  notices — a large enough sample for every assertion below, and small enough that
 *  the gate stays inside an ordinary `npm run test:unit`. A gate nobody can afford
 *  to run is the failure this file already had once. */
const SAMPLE_ROWS = Number(process.env.EOP_COVERAGE_SAMPLE ?? 2000);

interface Details {
  TenderPublicationDetails?: { HtmlPreview?: string }[];
}

/**
 * Yield dossier bodies without holding more than one page of them.
 *
 * ⚠️ THE SAMPLE IS STRIDED ACROSS THE WHOLE ID RANGE, NEVER A PREFIX, and that is a
 * correctness requirement rather than tidiness. `subject_id` tracks the register's
 * own chronology, and the eForms/legacy split is an ERA split — measured 2026-08-25
 * over ids 56,505..600,641: the first 300 dossiers are 3.9% eForms notices and the
 * last 300 are 98.5%. A `LIMIT 2000` prefix would therefore measure the legacy era
 * and report it as the corpus, and the two tier assertions below would be passing or
 * failing on which end of the crawl they happened to land in.
 */
function* dossiers(
  store: EopDossierStore,
  ids: number[],
): Generator<{ subjectId: number; body: Details }> {
  if (FULL) {
    yield* store.iterate<Details>("details", 200);
    return;
  }
  for (const subjectId of ids) {
    const body = store.getJson<Details>("details", subjectId);
    if (body) yield { subjectId, body };
  }
}

interface Coverage {
  /** Dossiers actually read — the sample size, so a caption can state its basis. */
  dossiers: number;
  /** Dossiers carrying at least one rendered publication. */
  tenders: number;
  notices: number;
  pairs: number;
  /** Notices that parsed to zero pairs, with a few ids to start debugging from. */
  emptyNotices: number;
  emptyIds: number[];
  parenCodes: number;
  /** Labels still carrying an un-stripped eForms code — the demotion defect. */
  poisonedLabels: string[];
  durationValues: number;
  /** BT-36-Lot values that are not a bare number — i.e. the register started
   *  printing the unit inline, which is the regression this pins. */
  durationNonNumeric: string[];
  eformsNotices: number;
  richEformsNotices: number;
  priceOnlyTrue: number;
  priceOnlyFalse: number;
  priceOnlyNull: number;
  /** Values that look like a CSS rule or a function body leaked past stripHtml. */
  leakedMarkup: string[];
}

/** ONE streaming pass. Every per-notice structure is scoped to its iteration; the
 *  only things that survive are the counters and four capped example arrays. */
const scan = (store: EopDossierStore, ids: number[]): Coverage => {
  const c: Coverage = {
    dossiers: 0,
    tenders: 0,
    notices: 0,
    pairs: 0,
    emptyNotices: 0,
    emptyIds: [],
    parenCodes: 0,
    poisonedLabels: [],
    durationValues: 0,
    durationNonNumeric: [],
    eformsNotices: 0,
    richEformsNotices: 0,
    priceOnlyTrue: 0,
    priceOnlyFalse: 0,
    priceOnlyNull: 0,
    leakedMarkup: [],
  };

  for (const { subjectId, body } of dossiers(store, ids)) {
    c.dossiers++;
    const pubs = body.TenderPublicationDetails ?? [];
    if (!pubs.length) continue;
    c.tenders++;

    for (const p of pubs) {
      if (!p.HtmlPreview) continue;
      c.notices++;
      const pairs = parseNoticePairs(p.HtmlPreview);
      c.pairs += pairs.length;
      if (pairs.length === 0) {
        c.emptyNotices++;
        if (c.emptyIds.length < 5) c.emptyIds.push(subjectId);
        continue;
      }

      for (const pair of pairs) {
        if (pair.code?.includes("(")) c.parenCodes++;
        if (
          /\((?:BT|OPT|OPP)-[0-9]/.test(pair.label) &&
          c.poisonedLabels.length < 5
        )
          c.poisonedLabels.push(pair.label);
        if (
          /\{[^}]*:[^}]*\}|function\s*\(/.test(pair.value) &&
          c.leakedMarkup.length < 3
        )
          c.leakedMarkup.push(pair.value.slice(0, 60));
      }

      const fields = noticeFields(pairs);
      if (fields.isEforms) c.eformsNotices++;
      if (fields.btCount > 10) c.richEformsNotices++;
      if (fields.durationValue) {
        c.durationValues++;
        // ⚠️ NOT `/^\d+$/` — see the gate below. Decimals are legitimate values.
        if (
          !/^\d+(?:[.,]\d+)?$/.test(fields.durationValue.trim()) &&
          c.durationNonNumeric.length < 5
        )
          c.durationNonNumeric.push(fields.durationValue);
      }
      const verdict = isPriceOnly(fields);
      if (verdict === true) c.priceOnlyTrue++;
      else if (verdict === false) c.priceOnlyFalse++;
      else c.priceOnlyNull++;
    }
  }
  return c;
};

// ---- skip, visibly and for a distinct reason --------------------------------
// Same shape as aop_experts.data.test.ts / isun_clean_delivery.data.test.ts: a
// reason string or `false`, warned once so "skipped" never reads as "passed".
// The store is a gitignored ~26 h crawl, so "absent" is the normal state on CI and
// on a fresh clone, and "present but holds no dossiers" is a different failure that
// must not be reported as the same thing.

let store: EopDossierStore | null = null;
let detailIds: number[] = [];
let skip: string | false = false;

const rel = path.relative(process.cwd(), STORE);

if (!fs.existsSync(STORE)) {
  skip = `${rel} absent — run npx tsx scripts/procurement/ingest_eop_dossier.ts (rate-limited crawl, not a pipeline step)`;
} else if (!FULL && (!Number.isInteger(SAMPLE_ROWS) || SAMPLE_ROWS < 1)) {
  // Checked HERE rather than left to strideSample's throw, which the catch below
  // would report as "unreadable" and blame the store for an env-var typo.
  skip = `EOP_COVERAGE_SAMPLE=${process.env.EOP_COVERAGE_SAMPLE} is not a positive integer — refusing to sample nothing and call it a pass`;
} else {
  // ⚠️ OPENING THE STORE CAN THROW, AND AN UNCAUGHT THROW HERE IS THE ORIGINAL BUG
  // IN ITS OTHER FORM. This runs at module scope, so anything raised kills
  // COLLECTION — the file reports "no tests" plus an error, which is exactly the
  // shape that reads as green in the suite summary. The realistic cause is not
  // hypothetical: `new EopDossierStore()` opens read-write (it applies SCHEMA and
  // runs reconcile()), and the ~26 h crawl that writes this store may be holding a
  // write lock, so a developer running the suite mid-crawl gets SQLITE_BUSY. Turn
  // every such failure into a visible skip carrying the driver's own message.
  try {
    store = new EopDossierStore(STORE);
    const all = [...store.answeredIds("details")].sort((a, b) => a - b);
    if (all.length === 0) {
      skip = `${rel} holds no 'details' dossiers — the crawl captured ids but no bodies`;
    } else if (FULL) {
      detailIds = all;
    } else {
      // Stride, not a prefix — see `dossiers()` and `strideSample`'s own header.
      // It lives in a separate module so the rule can be unit-tested without
      // opening this 1.8 GB store; `eop_coverage_sample.test.ts` is what makes the
      // "just LIMIT it" edit fail.
      detailIds = strideSample(all, SAMPLE_ROWS);
    }
  } catch (e) {
    skip = `${rel} unreadable — ${e instanceof Error ? e.message : String(e)}`;
  }
}

// Reported TWICE on purpose, because neither channel is sufficient alone.
// `console.warn` matches the sibling gates and is what a developer sees in a TTY;
// `ctx.skip(reason)` attaches the reason to every skipped test, so it survives into
// `--reporter=verbose` and the JSON reporter, where the default reporter shows only
// a bare "8 skipped". Measured: the default reporter prints NEITHER the console line
// nor a test name when piped, so a gate that reports only through console.warn is
// invisible in exactly the CI logs that would have to catch it.
if (skip) console.warn(`eop_notice_coverage.data.test: skipped — ${skip}`);

let cov: Coverage | null = null;

/** A test that runs against the scan, or skips carrying the reason it could not. */
const gate = (name: string, assert: (c: Coverage) => void) =>
  test(name, (ctx) => {
    if (skip) return ctx.skip(skip);
    assert(cov as Coverage);
  });

afterAll(() => {
  store?.close();
});

describe("notice parse coverage (captured store)", () => {
  beforeAll(
    () => {
      if (skip) return;
      cov = scan(store as EopDossierStore, detailIds);
      console.warn(
        `eop_notice_coverage.data.test: ${FULL ? "FULL corpus" : "sampled"} ` +
          `${cov.dossiers} dossiers / ${cov.notices} notices / ${cov.pairs} pairs` +
          `${FULL ? "" : ` (of ${detailIds.length} picked; EOP_COVERAGE_FULL=1 for all)`}`,
      );
    },
    // The sample is ~10 s; the full walk streams 17.8 GB and needs its own budget
    // (measured 4.34 min end to end at 79 MB peak heap).
    FULL ? 30 * 60_000 : 120_000,
  );

  gate("the store actually has notices to measure", (c) => {
    expect(c.tenders).toBeGreaterThan(0);
    expect(c.notices).toBeGreaterThan(0);
  });

  // A parser that failed to decode entities, or whose class-name anchors went stale,
  // returns zero pairs while still "passing" every unit test.
  gate("no notice parses to zero pairs", (c) => {
    expect({ empty: c.emptyNotices, examples: c.emptyIds }).toEqual({
      empty: 0,
      examples: [],
    });
  });

  gate("pairs per notice stays in the measured band", (c) => {
    const mean = c.pairs / (c.notices || 1);
    // ⚠️ THE OLD FLOOR WAS 50 AGAINST A COMMENT CLAIMING "measured 239", AND BOTH
    // WERE STALE. 239 was measured on the 1,861-procedure capture; measured
    // 2026-08-25 the mean is **52.9** over the full corpus (11,248,485 pairs across
    // 212,750 notices) and 52.6 on the 2,000-dossier stride sample. The crawl has
    // since filled in the legacy era, whose notices are far shorter. So the shipped
    // gate sat 5% above a floor it had been given 5x of headroom against, and an
    // ordinary crawl of more legacy notices would have turned it red for no defect.
    //
    // Kept deliberately wide, at roughly a fifth of the measured mean — the same
    // ratio the original floor had to its own measurement. This is a regression gate
    // for "the parse collapsed", not an assertion about the register's form design.
    expect(mean).toBeGreaterThan(10);
  });

  // The defect this file was written for. A code that is silently demoted also
  // leaves its raw text in `label`, so the legacy tier's only key is poisoned too.
  gate(
    "parenthesised eForms codes are recognised, not demoted to legacy",
    (c) => {
      expect(c.parenCodes).toBeGreaterThan(0);
      // No pair may keep an un-stripped eForms code in its label.
      expect(c.poisonedLabels).toEqual([]);
    },
  );

  gate(
    "BT-36-Lot really is a bare number — the field name must not promise a unit",
    (c) => {
      expect(c.durationValues).toBeGreaterThan(0);
      // If the register ever starts printing the unit inline, this fails and the
      // field can be renamed back — which is the point of pinning it.
      //
      // ⚠️ THE PREDICATE IS "NO UNIT", NOT "IS AN INTEGER", AND THE ORIGINAL
      // `/^\d+$/` CONFLATED THE TWO. Measured 2026-08-25 over the full corpus: 2 of
      // 2,279 BT-36-Lot values are decimals — `24.93` (dossier 210447) and `23.93`
      // (242838) — so the shipped assertion was RED on the real corpus and nobody
      // could see it, because the OOM meant it never ran. They are not a parse
      // artifact: the register emits `<div class="name"> 24.93</div>` and puts the
      // unit in a SEPARATE, unlabelled sibling cell (`<div class="name"> Месец</div>`),
      // which the structural parser correctly declines to fold in. So the value really
      // is unit-free, which is exactly what this gate claims — a decimal duration is
      // the register's own data, and `"24 Месец"` would still fail.
      //
      // Consequence worth knowing, and NOT fixed here: `durationValue` therefore
      // cannot tell you 24.93 of WHAT. The unit is unreachable from `noticeFields`
      // because that sibling cell carries no `label__name` to key on.
      //
      // Note the default sample reaches neither outlier (97 values, all integers), so
      // this is one of the assertions only EOP_COVERAGE_FULL=1 exercises fully.
      expect(c.durationNonNumeric).toEqual([]);
    },
  );

  gate(
    "the eForms/legacy split is measurable and both tiers are non-degenerate",
    (c) => {
      expect(c.eformsNotices).toBeGreaterThan(0);
      // Every notice exposing exactly zero codes would mean CODE_RE stopped matching.
      expect(c.richEformsNotices).toBeGreaterThan(0);
    },
  );

  // Tri-state, and all three states must occur — otherwise `null` is doing no work
  // and the signal has quietly become a boolean.
  gate("isPriceOnly discriminates all three states on the real corpus", (c) => {
    expect(c.priceOnlyTrue).toBeGreaterThan(0);
    expect(c.priceOnlyFalse).toBeGreaterThan(0);
    expect(c.priceOnlyNull).toBeGreaterThan(0);
  });

  gate("script and style bodies do not leak into the parsed values", (c) => {
    expect(c.leakedMarkup).toEqual([]);
  });
});
