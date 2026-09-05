// Write `raw_data/<cycle>_pvr/SOURCE.json` from archives already sitting in a local
// directory, rather than by downloading them again.
//
// ⚠ WHY THIS EXISTS AS A COMMITTED SCRIPT. The five historical trees were assembled by
// hand on 2026-09-05, before `download.ts` existed, so their provenance would
// otherwise have been written by a throwaway snippet — a record of measurements with
// no producer, which is the unverifiable-claim shape this repo treats as worse than no
// claim. Anyone holding the same archives can re-run this and get the same file.
//
//   npx tsx scripts/parsers_presidential/stamp_from_archives.ts --dir <archives>
//
// It matches an archive to a (cycle, archive-key) by CONTENT — the md5 declared in
// `sources.ts` — never by filename, so a differently-named copy of the same bytes
// still lands in the right slot and a same-named different file does not.
//
// It downloads nothing and touches no round folder: the only file it writes is
// SOURCE.json. Plan: docs/plans/presidential-elections-v1.md T1.4.

import fs from "node:fs";
import path from "node:path";
import { PRESIDENTIAL_SOURCES } from "./sources";
import { md5File, writeStamp, type ArchiveMeasurement } from "./download";

/** How a tree got its bytes when this tooling did not download it. Keyed
 *  `<cycle>/<archiveKey>`; anything absent is simply unmeasured. */
export const KNOWN_ORIGINS: Record<string, string> = {
  // Round 1's presidential files were copied out of the pre-existing (gitignored)
  // local tree `raw_data/2011_10_23_mi/ТУР1/президент/`, which had been extracted
  // from this same joint archive by the local-elections ingest. The URL is right; the
  // archive was simply never fetched by this tooling, so there is no digest to record.
  "2011_10_23_pvr/tur1":
    "copied from the pre-existing local tree raw_data/2011_10_23_mi/ТУР1/президент/, " +
    "extracted from this same joint archive by the local-elections ingest",
};

/** When the archives in the operator's directory were actually fetched. ⚠ NOT the
 *  time this script runs: it measures files downloaded earlier, and stamping its own
 *  run time as `fetchedAt` would be a small invented fact in the one file whose whole
 *  job is provenance. Overridable for a future re-stamp of differently-dated bytes. */
export const DEFAULT_FETCHED_AT = "2026-09-05T00:00:00.000Z";

export const stampFromArchives = (
  archiveDir: string,
  fetchedAt: string = DEFAULT_FETCHED_AT,
): { cycle: string; matched: string[]; unmeasured: string[] }[] => {
  if (!fs.existsSync(archiveDir)) {
    throw new Error(`No such directory: ${archiveDir}`);
  }
  const zips = fs
    .readdirSync(archiveDir)
    .filter((f) => f.toLowerCase().endsWith(".zip"))
    .map((f) => path.join(archiveDir, f));
  // md5 → the files carrying it. Two round URLs serving one archive is normal here
  // (2016), so this is deliberately many-to-one rather than a plain map.
  const byDigest = new Map<string, string[]>();
  for (const z of zips) {
    const digest = md5File(z);
    byDigest.set(digest, [...(byDigest.get(digest) ?? []), z]);
  }
  console.log(
    `[stamp] ${zips.length} archive(s) in ${archiveDir}, ${byDigest.size} distinct digest(s)`,
  );

  const report: { cycle: string; matched: string[]; unmeasured: string[] }[] =
    [];
  for (const source of Object.values(PRESIDENTIAL_SOURCES)) {
    const measured: Record<string, ArchiveMeasurement> = {};
    const matched: string[] = [];
    const unmeasured: string[] = [];
    for (const [key, archive] of Object.entries(source.archives)) {
      const origin = KNOWN_ORIGINS[`${source.cycle}/${key}`];
      if (!archive.md5) {
        // Nothing declared to match on. Record the origin if we know one, so the
        // stamp says what happened instead of only that nothing was downloaded.
        if (origin) measured[key] = { downloadedHere: false, origin };
        unmeasured.push(key);
        continue;
      }
      const hit = byDigest.get(archive.md5)?.[0];
      if (!hit) {
        unmeasured.push(key);
        continue;
      }
      measured[key] = {
        bytes: fs.statSync(hit).size,
        md5: archive.md5,
        downloadedHere: true,
      };
      matched.push(`${key}=${path.basename(hit)}`);
    }
    writeStamp(source, measured, matched.length ? fetchedAt : undefined);
    report.push({ cycle: source.cycle, matched, unmeasured });
    console.log(
      `[stamp] ${source.cycle}: ${matched.length} matched (${matched.join(", ") || "—"}), ` +
        `${unmeasured.length} unmeasured (${unmeasured.join(", ") || "—"})`,
    );
  }
  return report;
};

const isMain = process.argv[1]?.endsWith("stamp_from_archives.ts");
if (isMain) {
  const i = process.argv.indexOf("--dir");
  if (i === -1 || !process.argv[i + 1]) {
    console.error(
      "usage: tsx scripts/parsers_presidential/stamp_from_archives.ts --dir <archives>",
    );
    process.exit(1);
  }
  stampFromArchives(process.argv[i + 1]);
}
