// The keep.eu crawl driver: walk the index, then fill the raw detail cache.
//
//   npm run funds:crawl-interreg                    # incremental
//   npm run funds:crawl-interreg -- --full          # re-fetch every detail
//   npm run funds:crawl-interreg -- --max-pages 200 --index-only
//
// Writes only to the gitignored raw cache (raw_data/interreg/) — never to
// data/. parse.ts and ingest.ts (T1) turn this cache into the committed corpus,
// and keeping the two apart is what lets a ~2 h crawl be re-run, resumed or
// thrown away without touching a committed file.
//
// RESUMABILITY IS THE WHOLE DESIGN, because this runs unattended for hours:
//   - the manifest is checkpointed after every wave, so a crash costs one wave
//     rather than the whole walk;
//   - every manifest write is atomic, so a crash mid-write cannot truncate it;
//   - a corrupt manifest is a hard error, never a silent `null`;
//   - the stop id comes from THE MANIFEST, not from the detail cache — see
//     `deriveStopId` for why mixing the two stores is a data-loss bug;
//   - the detail pass skips ids already cached, so a restart costs only what is
//     genuinely missing.
//
// Data credit: keep.eu (INTERACT).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { atomicWriteJsonSync } from "../../lib/atomic_write";
import { programmeFor } from "./programmes";
import {
  walkIndex,
  fetchDetails,
  cachedKeepIds,
  RAW_DIR,
  MAX_CONCURRENCY,
  type AdmittedRow,
} from "./keep_fetch";

/** The index walk's own output, so a detail pass can resume without re-walking. */
export const MANIFEST = path.join(RAW_DIR, "..", "index_manifest.json");

/** Bumped when the shape changes. A manifest from another version is refused
 *  rather than misread — given how damaging a wrong row set is, an unknown
 *  shape has to be treated exactly like a corrupt one. */
export const MANIFEST_VERSION = 1;

/** An incremental walk older than this is not trusted to have seen revisions,
 *  because keep.eu re-imports whole programmes in place. */
export const FULL_WALK_MAX_AGE_DAYS = 35;

export interface Manifest {
  version: number;
  walkedAt: string;
  /** NULL until a `--full` run completes. Without it nobody can tell whether
   *  the monthly revision pass is overdue — and that is the whole risk. */
  lastFullWalkAt: string | null;
  /** False while a walk is in progress, or when pages went unrecovered. An
   *  incremental walk must never advance over an incomplete manifest. */
  complete: boolean;
  indexTotal: number;
  pagesFetched: number;
  failedPages?: number[];
  indexShifted?: boolean;
  rows: AdmittedRow[];
}

export class ManifestCorruptError extends Error {}
export class UnsafeIncrementalError extends Error {}

/**
 * Read the manifest. Returns null when ABSENT; throws when CORRUPT or from an
 * unknown version.
 *
 * The distinction is the point. Swallowing a parse error to `null` makes a
 * truncated manifest indistinguishable from a first run: the walk restarts,
 * writes back a handful of rows, and the summary prints as though all is well.
 */
export const readManifest = (file: string = MANIFEST): Manifest | null => {
  if (!fs.existsSync(file)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new ManifestCorruptError(
      `${file} is unreadable (${String(e)}). Delete it and re-run with --full; ` +
        `the detail cache is unaffected.`,
    );
  }
  const m = parsed as Partial<Manifest>;
  if (!m || !Array.isArray(m.rows))
    throw new ManifestCorruptError(
      `${file} has no rows[]. Delete it and re-run with --full.`,
    );
  if (m.version !== MANIFEST_VERSION)
    throw new ManifestCorruptError(
      `${file} is version ${String(m.version)}, expected ${MANIFEST_VERSION}. ` +
        `Delete it and re-run with --full.`,
    );
  return m as Manifest;
};

/**
 * Where an incremental walk may stop — derived from the MANIFEST alone.
 *
 * Taking it from the detail cache instead is a data-loss bug: the stop id and
 * the row set would come from two different stores, so a lost manifest plus an
 * intact cache yields a high stop id, a walk that ends after two waves, and a
 * manifest rewritten with five rows — all at exit 0. A checkpointed *partial*
 * manifest is the same trap, which is why an incomplete one refuses too.
 */
export const deriveStopId = (
  manifest: Manifest | null,
  opts: { full: boolean; cachedCount: number },
): number | undefined => {
  if (opts.full) return undefined;
  if (!manifest) {
    if (opts.cachedCount > 0)
      throw new UnsafeIncrementalError(
        "the detail cache is populated but the index manifest is missing.\n" +
          "  An incremental walk would silently truncate the corpus. Re-run with --full.",
      );
    return undefined;
  }
  if (!manifest.complete)
    throw new UnsafeIncrementalError(
      "the index manifest is marked incomplete (a previous walk was interrupted\n" +
        "  or left unrecovered pages). Re-run with --full.",
    );
  if (!manifest.rows.length) return undefined;
  return manifest.rows.reduce((a, r) => (r.keepId > a ? r.keepId : a), 0);
};

/**
 * Union prior rows with fresh ones, RE-VALIDATING every carried-forward row
 * against the admission gate.
 *
 * Without the re-validation the union is a one-way door that re-runs walk
 * around: de-admitting a programme, or correcting a wrong `keepProgrammeId`,
 * would leave its operations in the manifest indefinitely — even under --full.
 */
export const unionRows = (
  prior: AdmittedRow[],
  fresh: AdmittedRow[],
): AdmittedRow[] => {
  const byId = new Map<number, AdmittedRow>();
  for (const r of [...prior, ...fresh]) {
    const p = programmeFor(r.keepProgrammeId);
    if (!p) continue;
    byId.set(r.keepId, { ...r, programmeCode: p.code });
  }
  return [...byId.values()].sort((a, b) => b.keepId - a.keepId);
};

const hhmm = (ms: number): string => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
};

/**
 * Parse `--flag N` as a positive integer.
 *
 * An unparseable value must fail loudly. `--concurrency abc` became NaN, which
 * `??` does not catch, and the walk fetched 1 page of 5,451 and reported
 * success; `--concurrency 0` spun forever without issuing a request.
 */
export const positiveInt = (
  raw: string | undefined,
  flag: string,
  max?: number,
): number | undefined => {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1)
    throw new Error(
      `${flag} expects a positive integer, got ${JSON.stringify(raw)}`,
    );
  if (max !== undefined && n > max)
    throw new Error(`${flag} must be at most ${max}, got ${n}`);
  return n;
};

export const parseArgs = (argv: string[]) => {
  const has = (flag: string): boolean => argv.includes(flag);
  const val = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    full: has("--full"),
    indexOnly: has("--index-only"),
    detailsOnly: has("--details-only"),
    maxPages: positiveInt(val("--max-pages"), "--max-pages"),
    concurrency:
      positiveInt(val("--concurrency"), "--concurrency", MAX_CONCURRENCY) ??
      MAX_CONCURRENCY,
  };
};

const summarise = (rows: AdmittedRow[]): void => {
  const byProgramme = new Map<string, number>();
  for (const r of rows)
    byProgramme.set(
      r.programmeCode,
      (byProgramme.get(r.programmeCode) ?? 0) + 1,
    );
  for (const [code, n] of [...byProgramme].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(5)}  ${code}`);
};

const daysSince = (iso: string | null): number | null =>
  iso === null ? null : (Date.now() - Date.parse(iso)) / 86_400_000;

export const main = async (
  argv: string[] = process.argv.slice(2),
): Promise<void> => {
  const { full, indexOnly, detailsOnly, maxPages, concurrency } =
    parseArgs(argv);

  const t0 = Date.now();
  let manifest = readManifest();

  if (!detailsOnly) {
    const stopAtKeepId = deriveStopId(manifest, {
      full,
      cachedCount: cachedKeepIds().length,
    });

    console.log(
      `interreg: walking the keep.eu index` +
        (stopAtKeepId !== undefined
          ? ` (stopping at id ${stopAtKeepId})`
          : " (full walk)") +
        ` at ${concurrency}-way concurrency`,
    );
    if (stopAtKeepId !== undefined) {
      console.log(
        "  note: an incremental walk finds NEW operations only. Run --full monthly\n" +
          "  to pick up revisions from keep.eu's whole-programme re-imports.",
      );
      const age = daysSince(manifest?.lastFullWalkAt ?? null);
      if (age === null || age > FULL_WALK_MAX_AGE_DAYS)
        console.warn(
          `  WARNING: last full walk ${age === null ? "never recorded" : `${Math.round(age)} days ago`} ` +
            `(> ${FULL_WALK_MAX_AGE_DAYS}d) — revisions may be stale. Run --full.`,
        );
    }

    const prior = manifest?.rows ?? [];
    const writeManifest = (m: Manifest): void =>
      atomicWriteJsonSync(MANIFEST, m, 1);

    let lastLogged = Date.now();
    const walk = await walkIndex({
      stopAtKeepId,
      concurrency,
      maxPages,
      onProgress: (done, total, admitted) => {
        // Throttle on elapsed time, not on a count that moves in strides of
        // `concurrency`: `done % 80` at 8-way has no solution, which is how the
        // first version printed nothing for two hours.
        if (done !== total && Date.now() - lastLogged < 30_000) return;
        lastLogged = Date.now();
        console.log(
          `  ${done}/${total} pages · ${admitted} admitted · ${hhmm(Date.now() - t0)}`,
        );
      },
      onCheckpoint: (rows, pagesFetched) =>
        writeManifest({
          version: MANIFEST_VERSION,
          walkedAt: new Date().toISOString(),
          lastFullWalkAt: manifest?.lastFullWalkAt ?? null,
          complete: false,
          indexTotal: manifest?.indexTotal ?? 0,
          pagesFetched,
          rows: unionRows(prior, rows),
        }),
    });

    const clean = walk.failedPages.length === 0;
    manifest = {
      version: MANIFEST_VERSION,
      walkedAt: new Date().toISOString(),
      lastFullWalkAt:
        full && clean
          ? new Date().toISOString()
          : (manifest?.lastFullWalkAt ?? null),
      complete: clean,
      indexTotal: walk.total,
      pagesFetched: walk.pagesFetched,
      ...(walk.failedPages.length ? { failedPages: walk.failedPages } : {}),
      ...(walk.indexShifted ? { indexShifted: true } : {}),
      rows: unionRows(prior, walk.rows),
    };
    writeManifest(manifest);

    console.log(
      `\ninterreg: index walk done in ${hhmm(Date.now() - t0)} — ` +
        `${walk.pagesFetched} pages of ${walk.total} projects, ` +
        `${manifest.rows.length} in admitted programmes`,
    );
    if (walk.failedPages.length) {
      console.warn(
        `  WARNING: ${walk.failedPages.length} page(s) failed twice and are NOT ` +
          `represented: ${walk.failedPages.slice(0, 20).join(", ")}`,
      );
      console.warn("  The manifest is marked incomplete. Re-run with --full.");
      process.exitCode = 1;
    }
    if (walk.indexShifted)
      console.warn(
        `  WARNING: the index moved under the walk (${walk.countAtStart} → ` +
          `${walk.countAtEnd} projects) — pagination shifted, so rows may have ` +
          `been skipped. Re-run with --full to be sure.`,
      );
    summarise(manifest.rows);
  }

  if (indexOnly) return;
  if (!manifest) {
    console.error(
      "interreg: no index manifest — run without --details-only first.",
    );
    process.exitCode = 1;
    return;
  }

  const t1 = Date.now();
  console.log(
    `\ninterreg: fetching details for ${manifest.rows.length} operations` +
      (full ? " (--full: re-fetching cached ids too)" : " (skipping cached)"),
  );
  let lastDetail = Date.now();
  const res = await fetchDetails(
    manifest.rows.map((r) => r.keepId),
    {
      concurrency,
      force: full,
      onProgress: (done, total) => {
        if (done !== total && Date.now() - lastDetail < 30_000) return;
        lastDetail = Date.now();
        console.log(`  ${done}/${total} details · ${hhmm(Date.now() - t1)}`);
      },
    },
  );

  console.log(
    `\ninterreg: ${res.fetched} fetched, ${res.skipped} already cached, ` +
      `${res.missing.length} missing (404), ${res.failed.length} failed ` +
      `in ${hhmm(Date.now() - t1)}`,
  );
  if (res.missing.length)
    console.log(`  404 ids: ${res.missing.slice(0, 20).join(", ")}`);
  if (res.failed.length) {
    console.warn(
      `  WARNING: ${res.failed.length} id(s) failed — re-run to pick them up:`,
    );
    for (const f of res.failed.slice(0, 10))
      console.warn(`    ${f.keepId}: ${f.error}`);
    process.exitCode = 1;
  }
  console.log(`interreg: cache now holds ${cachedKeepIds().length} operations`);
};

const isMain =
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "");
if (isMain) {
  try {
    await main();
  } catch (e) {
    // A refusal is a designed outcome, not a stack trace: print the remedy.
    if (
      e instanceof UnsafeIncrementalError ||
      e instanceof ManifestCorruptError
    )
      console.error(`interreg: ${e.message}`);
    else throw e;
    process.exitCode = 1;
  }
}
