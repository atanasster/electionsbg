// Turn the gitignored keep.eu crawl cache into the committed Interreg corpus.
//
//   npm run funds:ingest-interreg               # write data/funds/interreg/
//   npm run funds:ingest-interreg -- --dry-run  # report only, write nothing
//   npm run funds:ingest-interreg -- --programme INTERREG-ROBG-1420
//
// Tier T1 of docs/plans/interreg-funds-ingest-v1.md §8. Reads
// `raw_data/interreg/keep/` (gitignored, filled by `funds:crawl-interreg`) and
// writes three committed files. It fetches nothing: crawl and ingest are
// separate so a ~40-minute network pass can be re-run, resumed or discarded
// without touching a committed file, and so this step is reproducible offline.
//
// IT CARRIES NO EKATTE. Place resolution is loader-side (§8) because Tiers L1/L2
// read `awarder_seats` and `tr_company_place` out of Postgres — an ingest that
// reached into PG would make this committed tree unreproducible from a fresh
// clone, and would put the ordering dependency in the wrong place.
//
// WHY data/funds/interreg/ AND NOT data/interreg/: `scripts/bucket_sync_paths.ts`
// refuses `rel === "funds" || rel.startsWith("funds/")` ("funds/ is served from
// Cloud SQL"), and `rel` is relative to `data/`. Sitting under `funds/` is what
// keeps this tree OUT of the public bucket; a new top-level directory would be
// uploaded, contradicting the PG-only serving rule. (`package.json`'s
// `bucket:sync` `-x` regex carries `^funds/.*` independently, so both
// mechanisms agree.)
//
// THREE GUARDS PRECEDE EVERY WRITE, and they catch different things:
//   assertCacheComplete — the cache holds every row the crawl manifest claims.
//   assertNoShrink      — the new corpus is not >5% smaller than the committed one.
//   assertFloors        — absolute minimums, the cold-start net when there is
//                         no committed corpus to compare against.
// The first two exist because the floors alone could not catch a MEASURED 20.5%
// loss: a cache with 400 truncated files yielded 1,554 operations and €95.18m
// less Bulgarian money, and both floors passed.
//
// Data credit: keep.eu (INTERACT).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  atomicWriteFileSync,
  atomicWriteJsonSync,
} from "../../lib/atomic_write";
import { readManifest, type Manifest } from "./crawl";
import { cachedKeepIds, readCachedDetail } from "./keep_fetch";
import { parseOperation, type KeepProjectRaw } from "./parse";
import { INTERREG_PROGRAMMES, programmeByCode } from "./programmes";
import {
  isBulgarianPartner,
  type InterregIndex,
  type InterregOperation,
  type InterregPartner,
} from "./types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
export const OUT_DIR = path.join(ROOT, "data/funds/interreg");

/**
 * Absolute floors — the COLD-START net, checked before any write, in the spirit
 * of the ИСУН ingest's `MIN_ROWS = 60_000` (`projects_ingest.ts:76`).
 *
 * They are deliberately not the main guard. An absolute number set below a
 * measurement tolerates exactly the gap between the two (23% here), and that gap
 * only widens as keep.eu grows. `assertNoShrink` is what catches drift; these
 * catch the case where there is nothing yet to compare against.
 */
export const MIN_OPERATIONS = 1_500;
export const MIN_BG_PARTNERS = 1_200;

/** Plan §9 gate 1: a shrink beyond this against the committed corpus fails. */
export const MAX_SHRINK = 0.05;

export interface IngestResult {
  operations: InterregOperation[];
  partners: InterregPartner[];
  /** The Bulgarian subset, computed once — `report` and the index must not
   *  apply the definition twice and risk disagreeing. */
  bgPartners: InterregPartner[];
  index: InterregIndex;
  /**
   * Cache files that would not parse. ALWAYS a defect: the crawl caches only
   * admitted ids, so a healthy cache has none. `assertCacheComplete` is what
   * turns this from a log line into a refusal.
   */
  unreadable: number;
  /**
   * Cached projects belonging to a programme the curated register does not
   * admit. Normal — the admission gate doing its job. It must not share a
   * counter with `unreadable`, which means the opposite.
   */
  notAdmitted: number;
}

export interface BuildOptions {
  /** Debugging filter. Never writes — see `main`. */
  programme?: string;
  fetchedAt: string;
  /** Cache directory. Threaded so a test can point at a fixture directory. */
  dir?: string;
}

/** Build the corpus from the raw cache. Pure apart from reading the cache. */
export const buildCorpus = (opts: BuildOptions): IngestResult => {
  const operations: InterregOperation[] = [];
  const partners: InterregPartner[] = [];
  let unreadable = 0;
  let notAdmitted = 0;

  for (const keepId of cachedKeepIds(opts.dir)) {
    const raw = readCachedDetail<KeepProjectRaw>(keepId, opts.dir);
    if (!raw) {
      unreadable++;
      continue;
    }
    const parsed = parseOperation(raw);
    if (!parsed) {
      notAdmitted++;
      continue;
    }
    if (opts.programme && parsed.operation.programmeCode !== opts.programme)
      continue;
    operations.push(parsed.operation);
    partners.push(...parsed.partners);
  }

  // Deterministic order, so a re-run with no upstream change produces a
  // byte-identical file and `git diff` means something.
  operations.sort((a, b) => a.keepId - b.keepId);
  partners.sort((a, b) => a.keepId - b.keepId || a.partnerSeq - b.partnerSeq);

  const bgPartners = partners.filter(isBulgarianPartner);

  // One row per ADMITTED programme, including the ones that yield nothing.
  // A missing row and a zero row mean opposite things — "we never asked" versus
  // "we asked and keep.eu holds nothing" — and BG-Serbia 21-27 and ESPON 2030
  // are exactly the second kind.
  const programmes = INTERREG_PROGRAMMES.map((p) => {
    const ops = operations.filter((o) => o.programmeCode === p.code);
    const keys = new Set(ops.map((o) => o.keepId));
    const rows = partners.filter((q) => keys.has(q.keepId));
    const bgRows = rows.filter(isBulgarianPartner);
    return {
      code: p.code,
      period: p.period,
      operationCount: ops.length,
      partnerCount: rows.length,
      bgPartnerCount: bgRows.length,
      bgBudgetEur: bgRows.reduce((a, q) => a + (q.budgetEur ?? 0), 0),
      bgUnpublishedCount: bgRows.filter((q) => q.budgetBasis === "unpublished")
        .length,
    };
  });

  return {
    operations,
    partners,
    bgPartners,
    index: {
      fetchedAt: opts.fetchedAt,
      operationCount: operations.length,
      partnerCount: partners.length,
      bgPartnerCount: bgPartners.length,
      programmes,
    },
    unreadable,
    notAdmitted,
  };
};

const eur = (n: number): string => `€${(n / 1e6).toFixed(2)}m`;

export const report = (r: IngestResult, programme?: string): void => {
  if (programme)
    console.log(
      `interreg: FILTERED to ${programme} — every other programme reads 0 below ` +
        `because it was not requested, not because keep.eu holds nothing.`,
    );
  console.log(
    `interreg: ${r.operations.length} operations, ${r.partners.length} partnerships, ` +
      `${r.index.bgPartnerCount} Bulgarian partner rows`,
  );
  const money = r.bgPartners.reduce((a, p) => a + (p.budgetEur ?? 0), 0);
  const withEik = r.bgPartners.filter((p) => p.eik).length;
  const n = r.bgPartners.length || 1;
  console.log(
    `  BG budget ${eur(money)} · ${withEik} rows carry an EIK ` +
      `(${((100 * withEik) / n).toFixed(1)}%, Tier L) · ` +
      `${r.bgPartners.length - withEik} place-only (Tier P)`,
  );
  const basis = r.bgPartners.reduce<Record<string, number>>((a, p) => {
    a[p.budgetBasis] = (a[p.budgetBasis] ?? 0) + 1;
    return a;
  }, {});
  console.log(`  budget basis: ${JSON.stringify(basis)}`);
  if (r.notAdmitted)
    console.log(
      `  ${r.notAdmitted} cached project(s) belong to no admitted programme (expected)`,
    );
  if (r.unreadable)
    console.error(
      `  ERROR: ${r.unreadable} cache file(s) would not parse — the cache is damaged`,
    );

  console.log(
    "\n  programme                   period      ops  partners   BG      BG budget",
  );
  for (const p of r.index.programmes) {
    // Only meaningful on an unfiltered run: under --programme the other 21 read
    // zero because they were not requested, which is the opposite of "empty".
    const flag = p.operationCount === 0 && !programme ? "  ← empty" : "";
    console.log(
      `  ${p.code.padEnd(26)} ${p.period}  ${String(p.operationCount).padStart(4)}` +
        `  ${String(p.partnerCount).padStart(8)}  ${String(p.bgPartnerCount).padStart(4)}` +
        `  ${eur(p.bgBudgetEur).padStart(10)}${flag}`,
    );
  }
};

/**
 * The corpus holds every operation the crawl manifest claims.
 *
 * THIS IS THE GUARD THE FLOORS CANNOT BE. Measured: truncating 400 of 1,954
 * cache files yields 1,554 operations, 9,261 partnerships and €95.18m less
 * Bulgarian money — and both absolute floors pass, so the short corpus commits
 * at exit 0 with every internal count reconciling.
 *
 * `crawl.ts` already refuses this class for its own walk, in the same words.
 * The ingest is the step that writes the committed artifact, so it needs it
 * more. It also names the ids, so the remedy is a targeted re-fetch rather than
 * another 40-minute crawl.
 */
export const assertCacheComplete = (
  r: IngestResult,
  manifest: Manifest | null = readManifest(),
): void => {
  if (!manifest)
    throw new Error(
      "interreg: the detail cache is populated but the index manifest is missing — " +
        "the corpus would be silently truncated. Run " +
        "`npm run funds:crawl-interreg -- --full`; nothing was written.",
    );
  if (!manifest.complete)
    throw new Error(
      "interreg: the index manifest is marked incomplete (an interrupted walk, or " +
        "pages that never recovered). Re-run `npm run funds:crawl-interreg -- --full` " +
        "before ingesting; nothing was written.",
    );
  const got = new Set(r.operations.map((o) => o.keepId));
  const lost = manifest.rows
    .filter((row) => !got.has(row.keepId))
    .map((row) => row.keepId);
  if (lost.length)
    throw new Error(
      `interreg: ${lost.length} of ${manifest.rows.length} manifest rows did not parse — ` +
        `the cache is damaged or incomplete. Re-fetch with ` +
        `\`npm run funds:crawl-interreg -- --details-only\`; nothing was written.\n` +
        `  ids: ${lost.slice(0, 20).join(", ")}` +
        (lost.length > 20 ? ` … +${lost.length - 20} more` : ""),
    );
};

/**
 * Plan §9 gate 1, applied at T1 where it is free: the committed `index.json` is
 * on disk at the moment of the write, so "did the corpus shrink" is an exact
 * question rather than a guess against a hand-set constant.
 *
 * Absent (first run) → skip. That is what the absolute floors are for.
 */
export const assertNoShrink = (
  r: IngestResult,
  dir = OUT_DIR,
  allowShrink = false,
): void => {
  if (allowShrink) return;
  const file = path.join(dir, "index.json");
  if (!fs.existsSync(file)) return;
  let prev: InterregIndex;
  try {
    prev = JSON.parse(fs.readFileSync(file, "utf8")) as InterregIndex;
  } catch {
    return; // an unreadable previous index is not evidence of a shrink
  }
  for (const [what, now, before] of [
    ["operations", r.operations.length, prev.operationCount],
    ["partnerships", r.partners.length, prev.partnerCount],
    ["Bulgarian partner rows", r.index.bgPartnerCount, prev.bgPartnerCount],
  ] as const)
    if (before > 0 && now < before * (1 - MAX_SHRINK))
      throw new Error(
        `interreg: ${what} ${now} is ${(100 * (1 - now / before)).toFixed(1)}% below the ` +
          `committed ${before}. Pass --allow-shrink if keep.eu really did withdraw them; ` +
          `nothing was written.`,
      );
};

/** Absolute floors — the cold-start net. See MIN_OPERATIONS. */
export const assertFloors = (r: IngestResult): void => {
  if (r.operations.length < MIN_OPERATIONS)
    throw new Error(
      `interreg: ${r.operations.length} operations is below the floor ${MIN_OPERATIONS} — ` +
        `the crawl cache looks partial. Run \`npm run funds:crawl-interreg -- --full\` ` +
        `and re-ingest; nothing was written.`,
    );
  if (r.index.bgPartnerCount < MIN_BG_PARTNERS)
    throw new Error(
      `interreg: ${r.index.bgPartnerCount} Bulgarian partner rows is below the floor ` +
        `${MIN_BG_PARTNERS} — aborting before write.`,
    );
};

/**
 * One JSON object per line. Still valid JSON and still `JSON.parse`-able whole
 * by the T2 loader, but a one-row change is a one-line diff.
 *
 * Measured on a one-field edit to one of 1,954 operations: compact writes a
 * 9.64 MB diff (the whole file, twice); this writes 49 KB — 197x smaller, for
 * +0.04% on disk. Moving `sourceFetchedAt` off the rows made "no change" mean
 * "no diff"; this makes "small change" mean "small diff", which is the other
 * half of the same goal.
 */
const writeRowsJson = (file: string, rows: unknown[]): void =>
  atomicWriteFileSync(
    file,
    rows.length
      ? `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`
      : "[]\n",
  );

export const writeCorpus = (r: IngestResult, dir = OUT_DIR): void => {
  fs.mkdirSync(dir, { recursive: true });
  writeRowsJson(path.join(dir, "operations.json"), r.operations);
  writeRowsJson(path.join(dir, "partners.json"), r.partners);
  // index.json LAST: the manifest must never claim rows the corpus does not yet
  // hold. A kill between writes then leaves an index that under-claims, which
  // ingest.test.ts's "matches its own index" catches on the next run.
  atomicWriteJsonSync(path.join(dir, "index.json"), r.index, 1);
};

export const main = (argv: string[] = process.argv.slice(2)): void => {
  const dryRun = argv.includes("--dry-run");
  const allowShrink = argv.includes("--allow-shrink");

  const pi = argv.indexOf("--programme");
  if (pi >= 0 && (argv[pi + 1] === undefined || argv[pi + 1].startsWith("--")))
    throw new Error(
      "--programme needs a programme code, e.g. `--programme INTERREG-ROBG-1420`. " +
        "Given with no value it would have written the FULL corpus, which is not " +
        "what a filter flag should do.",
    );
  const programme = pi >= 0 ? argv[pi + 1] : undefined;
  if (programme && !programmeByCode(programme))
    throw new Error(
      `--programme ${JSON.stringify(programme)} is not in the curated register ` +
        `(scripts/funds/interreg/programmes.ts)`,
    );

  if (!cachedKeepIds().length)
    throw new Error(
      "interreg: the keep.eu cache is empty. Run `npm run funds:crawl-interreg` first.",
    );

  const result = buildCorpus({
    programme,
    fetchedAt: new Date().toISOString(),
  });
  report(result, programme);

  if (programme) {
    console.log(
      "\ninterreg: --programme is a debugging filter; refusing to write a partial corpus.",
    );
    return;
  }
  assertCacheComplete(result);
  assertNoShrink(result, OUT_DIR, allowShrink);
  assertFloors(result);
  if (dryRun) {
    console.log("\ninterreg: --dry-run, nothing written.");
    return;
  }
  writeCorpus(result);
  console.log(`\ninterreg: wrote ${path.relative(ROOT, OUT_DIR)}/`);
};

const isMain =
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "");
if (isMain) main();
