// Acquire a presidential bundle from ЦИК and lay it out under
// `raw_data/<cycle>_pvr/ТУР1|ТУР2/`, then stamp what was fetched.
//
// ⚠ A FLAG-GATED OPERATOR STEP, NEVER PART OF THE WATCHER FLOW. It drives a HEADED
// Playwright window (the only thing that clears the per-resource Cloudflare challenge
// on results.cik.bg), downloads up to 130 MB, and rewrites a committed tree. Same
// convention as `--local-csv`: `npm run data -- --pvr-download <cycle>`.
//
// ⚠ IDEMPOTENT BY DEFAULT, AND THAT IS THE IMPORTANT PART. All five historical cycles
// are already committed, so the ordinary outcome of running this is that every round
// is present and NOTHING is downloaded. The point of keeping it is 2026: it is the
// same code path, exercised now against trees whose correct content is known, rather
// than written for the first time on election night.
//
//   npm run data -- --pvr-download 2021_11_14_pvr          # skips; re-stamps
//   npm run data -- --pvr-download pvr2026 --pvr-force     # re-fetch anyway
//
// Plan: docs/plans/presidential-elections-v1.md T1.2, T1.4.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { cikDownloadFile } from "../parsers_local/cik_fetch";
import { extractZipCp866 } from "../parsers_local/extract_bundle";
import {
  PRESIDENTIAL_SOURCES,
  archivesToFetch,
  presidentialSource,
  roundFolderName,
  type DownloadStrategy,
  type PresidentialSource,
  type RoundNumber,
} from "./sources";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_ROOT = path.resolve(__dirname, "../../raw_data");

export type StampedArchive = {
  url: string;
  strategy: DownloadStrategy;
  bytes: number | null;
  md5: string | null;
  /** Whether THIS tooling downloaded it. `false` with a null digest means nobody has
   *  measured it here — never "any bytes will do". */
  downloadedHere: boolean;
  /** Where the bytes came from when `downloadedHere` is false. Free text, absent when
   *  they were downloaded here. Without it, `downloadedHere: false` records only that
   *  the tooling did not fetch the tree and not what did — which is half of the
   *  question this file exists to answer. */
  origin?: string;
};

/** What `SOURCE.json` records: where each byte came from, and when. */
export type SourceStamp = {
  cycle: string;
  slug: string;
  /** When this FILE was last written — NOT when the bytes were fetched. The five
   *  historical trees were stamped in one pass, so their timestamps are ~1 ms apart
   *  and could not possibly be five download times. */
  stampedAt: string;
  /** When this tooling last actually downloaded something for this cycle. Absent for
   *  a tree it never fetched. */
  fetchedAt?: string;
  archives: Record<string, StampedArchive>;
  rounds: Record<string, { archive: string; subtree: string; date: string }>;
  note: string;
};

/** What one run learned about an archive.
 *
 *  ⚠ `bytes`/`md5` are OPTIONAL so that "I know where this came from but never
 *  measured it" is expressible — the 2011 round-1 case. A shape that forced a number
 *  would make callers invent a zero, which is a measurement nobody took. */
export type ArchiveMeasurement = {
  bytes?: number;
  md5?: string;
  downloadedHere: boolean;
  origin?: string;
};

export const md5File = (file: string): string =>
  crypto.createHash("md5").update(fs.readFileSync(file)).digest("hex");

/** A round is "present" when its folder holds at least one file. Deliberately not a
 *  content check: this decides whether to spend a 130 MB download, and the real
 *  content gates live in `sources.test.ts` (each ТУРn carries its own round) and in
 *  the era readers' own fixtures.
 *
 *  ⚠ Because it is only a non-empty check, placement MUST be atomic — see
 *  `placeSubtree`. A half-copied round would otherwise read as present for ever. */
export const roundIsPresent = (cycle: string, round: RoundNumber): boolean => {
  const dir = path.join(RAW_ROOT, cycle, roundFolderName(round));
  return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
};

/**
 * Move an extracted archive's declared subtree into `raw_data/<cycle>/ТУРn/`.
 *
 * ⚠ ATOMIC, VIA A SIBLING DIRECTORY, and that is not defensive padding.
 * `roundIsPresent` asks only whether the folder is non-empty, so a copy that throws
 * halfway — a full disk, a permission error, an unreadable entry — would leave a round
 * holding SOME of its files, be reported as "already on disk" by every subsequent run,
 * and never be re-fetched. The corpus would be quietly incomplete while every later
 * run printed "skipped". Building beside the destination and swapping at the end means
 * a failure leaves the previous state exactly as it was.
 *
 * @param staging - Where the zip was unpacked.
 * @param subtree - The source entry's `subtree` (`""` means the archive root).
 * @param destination - The round folder to fill.
 * @returns How many files were placed. Never 0 — see below.
 */
export const placeSubtree = (
  staging: string,
  subtree: string,
  destination: string,
): number => {
  const from = subtree ? path.join(staging, subtree) : staging;
  if (!fs.existsSync(from)) {
    throw new Error(
      `Archive has no subtree "${subtree}" — found: ${fs
        .readdirSync(staging)
        .join(", ")}`,
    );
  }
  const incoming = `${destination}.incoming`;
  fs.rmSync(incoming, { recursive: true, force: true });
  fs.mkdirSync(incoming, { recursive: true });
  let placed = 0;
  const walk = (dir: string, rel: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const src = path.join(dir, e.name);
      const relPath = path.join(rel, e.name);
      if (e.isDirectory()) {
        walk(src, relPath);
      } else {
        const dest = path.join(incoming, relPath);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        placed++;
      }
    }
  };
  try {
    walk(from, "");
    // ⚠ An empty placement is a FAILURE, not a quiet success: the round would be
    // published empty and then read as "present" for ever by the skip check.
    if (placed === 0) {
      throw new Error(
        `Subtree "${subtree || "<root>"}" contained no files — refusing to publish ` +
          `an empty round folder`,
      );
    }
    // The swap: the previous content goes only once the new content is complete.
    const previous = `${destination}.previous`;
    fs.rmSync(previous, { recursive: true, force: true });
    if (fs.existsSync(destination)) fs.renameSync(destination, previous);
    fs.renameSync(incoming, destination);
    fs.rmSync(previous, { recursive: true, force: true });
    return placed;
  } finally {
    fs.rmSync(incoming, { recursive: true, force: true });
  }
};

/**
 * Read a cycle's existing stamp.
 *
 * ⚠ IT REFUSES A PRESENT-BUT-BROKEN FILE RATHER THAN REPORTING IT ABSENT. Returning
 * `null` there would make `mergeStamp` REPLACE — which is exactly the erasure the
 * merge exists to prevent, reached through a different door, with no error and no log
 * line. What is lost is not recoverable from the repo: `bytes` lives nowhere else, and
 * "the 2011 round-1 archive was never downloaded here" is a fact no producer can
 * re-derive. A malformed stamp is an operator problem, not a missing one.
 *
 * @param cycle - Cycle folder id.
 * @returns The stamp, or `null` when there genuinely is no file.
 */
export const readStamp = (cycle: string): SourceStamp | null => {
  const f = path.join(RAW_ROOT, cycle, "SOURCE.json");
  if (!fs.existsSync(f)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(f, "utf-8"));
  } catch (e) {
    throw new Error(
      `${f} is present but unparseable (${String(e)}). Fix or delete it — ` +
        `overwriting it would erase provenance nothing else records.`,
    );
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !("archives" in parsed)
  ) {
    // `JSON.parse("[]")` succeeds and the cast would hide it, after which every
    // `prior?.archives?.[key]` is undefined and the wipe happens through the happy
    // path.
    throw new Error(
      `${f} parsed but is not a SourceStamp (no "archives") — refusing to ` +
        `overwrite it.`,
    );
  }
  return parsed as SourceStamp;
};

/**
 * Fold this run's measurements into whatever the tree already recorded.
 *
 * ⚠ IT MERGES RATHER THAN REPLACES, and that is the whole point of the file. A run
 * that skipped an already-present round measured nothing about it, and must not erase
 * what an earlier run did measure — otherwise the idempotent path, which is the
 * ORDINARY one here, would empty the provenance every time it ran.
 *
 * @param source - The cycle's entry in `sources.ts`.
 * @param measured - What this run actually downloaded, keyed by archive.
 * @param prior - The existing stamp, or `null` when there genuinely is none.
 * @param now - Injected clock, so a test is not at the mercy of the wall time.
 * @returns The merged stamp. Pure — `writeStamp` does the IO.
 */
export const mergeStamp = (
  source: PresidentialSource,
  measured: Record<string, ArchiveMeasurement>,
  prior: SourceStamp | null,
  now: () => string = () => new Date().toISOString(),
  /** When the bytes were actually fetched, for a caller that KNOWS — the archive
   *  stamper, which measures files downloaded earlier and must not pass off its own
   *  run time as a fetch time. Omitted by the downloader, which fetched them now. */
  fetchedAtOverride?: string,
): SourceStamp => {
  const archives: Record<string, StampedArchive> = {};
  for (const [key, archive] of Object.entries(source.archives)) {
    const found = measured[key];
    const before = prior?.archives?.[key];
    const entry: StampedArchive = {
      url: archive.url,
      strategy: archive.strategy,
      bytes: found?.bytes ?? before?.bytes ?? archive.bytes ?? null,
      md5: found?.md5 ?? before?.md5 ?? archive.md5 ?? null,
      downloadedHere: found?.downloadedHere ?? before?.downloadedHere ?? false,
    };
    const origin = found?.origin ?? before?.origin;
    // Only meaningful for something this tooling did not fetch; carrying it on a
    // downloaded archive would contradict `downloadedHere`.
    if (origin && !entry.downloadedHere) entry.origin = origin;
    archives[key] = entry;
  }
  const didFetch = Object.values(measured).some((m) => m.downloadedHere);
  const stamp: SourceStamp = {
    cycle: source.cycle,
    slug: source.slug,
    stampedAt: prior?.stampedAt ?? now(),
    archives,
    rounds: Object.fromEntries(
      ([1, 2] as RoundNumber[]).map((r) => [
        String(r),
        {
          archive: source.rounds[r].archive,
          subtree: source.rounds[r].subtree,
          date: source.rounds[r].date,
        },
      ]),
    ),
    note: source.note,
  };
  const fetchedAt = didFetch
    ? (fetchedAtOverride ?? now())
    : (fetchedAtOverride ?? prior?.fetchedAt);
  if (fetchedAt) stamp.fetchedAt = fetchedAt;
  return stamp;
};

/**
 * Write `raw_data/<cycle>/SOURCE.json`, merging with what is already there.
 *
 * @param source - The cycle's entry in `sources.ts`.
 * @param measured - What this run downloaded, keyed by archive.
 * @param fetchedAtOverride - See `mergeStamp`.
 * @returns The stamp as written.
 */
export const writeStamp = (
  source: PresidentialSource,
  measured: Record<string, ArchiveMeasurement>,
  fetchedAtOverride?: string,
): SourceStamp => {
  const stamp = mergeStamp(
    source,
    measured,
    readStamp(source.cycle),
    undefined,
    fetchedAtOverride,
  );
  const dir = path.join(RAW_ROOT, source.cycle);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SOURCE.json"),
    JSON.stringify(stamp, null, 2) + "\n",
    "utf-8",
  );
  return stamp;
};

/**
 * Download and lay out one presidential cycle.
 *
 * @param key - Cycle id (`2021_11_14_pvr`) or ЦИК slug (`pvrns2021`).
 * @param opts.force - Re-fetch even when both rounds are already on disk
 *   (`--pvr-force`).
 * @param opts.allowDigestChange - Accept an archive whose md5 differs from the one
 *   `sources.ts` records (`--pvr-allow-digest-change`). Off by default: a changed
 *   digest means ЦИК re-published, which is a corpus event to investigate rather than
 *   to absorb.
 * @returns A short report; `downloaded` is 0 on the ordinary idempotent run.
 */
export const downloadPresidentialCycle = async (
  key: string,
  opts: { force?: boolean; allowDigestChange?: boolean } = {},
): Promise<{ cycle: string; downloaded: number; skipped: number }> => {
  const source = presidentialSource(key);
  if (!source) {
    throw new Error(
      `Unknown presidential cycle "${key}". Known: ${Object.keys(
        PRESIDENTIAL_SOURCES,
      ).join(", ")}`,
    );
  }
  console.log(`[pvr-download] ${source.cycle} (${source.slug})`);
  console.log(`[pvr-download] ${source.note}`);

  const measured: Record<string, ArchiveMeasurement> = {};
  let downloaded = 0;
  let skipped = 0;

  for (const { key: archiveKey, archive, rounds } of archivesToFetch(source)) {
    const needed = rounds.filter(
      (r) => opts.force || !roundIsPresent(source.cycle, r),
    );
    if (needed.length === 0) {
      skipped++;
      console.log(
        `[pvr-download]   ${archiveKey}: rounds ${rounds.join("+")} already on disk — skipped`,
      );
      continue;
    }
    const staging = path.join(RAW_ROOT, source.cycle, `_staging_${archiveKey}`);
    const zipPath = path.join(
      RAW_ROOT,
      source.cycle,
      `_${archiveKey}_bundle.zip`,
    );
    // ⚠ `finally`, not a happy-path cleanup: `raw_data/**_pvr` is TRACKED, so a throw
    // between here and the end would otherwise leave a 130 MB zip and an unpacked
    // staging tree in a committed directory, which the next `git status` offers to
    // commit. (The sibling local downloader gets away without this because its output
    // tree is gitignored wholesale.)
    try {
      fs.mkdirSync(path.dirname(zipPath), { recursive: true });
      console.log(`[pvr-download]   ${archiveKey}: ${archive.url}`);
      const saved = await cikDownloadFile(archive.url, zipPath, {
        warmUrl: archive.warmUrl,
        strategy: archive.strategy,
        timeoutMs: 300_000,
      });
      if (!saved) {
        throw new Error(
          `${source.cycle}/${archiveKey}: download produced no file. Strategy was ` +
            `"${archive.strategy}" — see sources.ts for why that one. Causes seen: ` +
            `the Cloudflare challenge did not clear, the URL 404s, or (for "click") ` +
            `the warm page carries no anchor for this archive.`,
        );
      }
      const bytes = fs.statSync(zipPath).size;
      const md5 = md5File(zipPath);
      // ⚠ A recorded digest is a CLAIM to check, not a note to carry forward — and it
      // is checked BEFORE extraction, so a wrong archive can never reach the tree.
      if (archive.md5 && archive.md5 !== md5 && !opts.allowDigestChange) {
        throw new Error(
          `${source.cycle}/${archiveKey}: md5 changed — expected ${archive.md5}, ` +
            `got ${md5} (${bytes} bytes). ЦИК re-published this archive. Re-verify ` +
            `the corpus against the official totals in the plan's §2.4, update ` +
            `sources.ts, then re-run with --pvr-allow-digest-change.`,
        );
      }
      measured[archiveKey] = { bytes, md5, downloadedHere: true };
      downloaded++;

      extractZipCp866(zipPath, staging);
      for (const round of needed) {
        const spec = source.rounds[round];
        const dest = path.join(RAW_ROOT, source.cycle, roundFolderName(round));
        const placed = placeSubtree(staging, spec.subtree, dest);
        console.log(
          `[pvr-download]   → ТУР${round}: ${placed} file(s) from "${spec.subtree || "<root>"}"`,
        );
      }
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
      fs.rmSync(zipPath, { force: true });
    }
  }

  const stamp = writeStamp(source, measured);
  console.log(
    `[pvr-download] ${source.cycle}: ${downloaded} archive(s) fetched, ` +
      `${skipped} skipped; stamped ${stamp.stampedAt}`,
  );
  return { cycle: source.cycle, downloaded, skipped };
};
