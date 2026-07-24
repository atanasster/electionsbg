// Merging a fresh ingest run into a declarant's accumulated filing history.
//
// Every cacbg ingest — MPs, executive officials, municipal officials — targets
// SOME set of register folder years but writes to a per-declarant file that
// accumulates every year ever ingested. Without merging, a run overwrites that
// file with only what it just fetched, silently deleting the rest of the
// person's history.
//
// That is not hypothetical. The officials leg has had these semantics from the
// start; the MP leg did not, and a single `DECL_YEARS=2025` run left 244 of the
// 245 MPs who filed in 2025 with ONLY 2025 on file — their 2021-2024
// declarations were deleted from the repo. This module exists so there is one
// implementation rather than one-per-ingest, since the leg that lacked it is
// exactly the leg that lost data.
//
// Semantics: a run is AUTHORITATIVE FOR THE YEARS IT TARGETS and additive
// everywhere else. Re-running a year replaces exactly that year's rows (so
// upstream corrections and removals land) and leaves every other year
// untouched, which makes re-runs idempotent.

import { byRecency, type DeclarationLike } from "../../src/lib/declarations";
import { registerFolderSegment } from "./cacbg_register";

/** Which run owns a row: the register folder it came from, verbatim, NOT its
 *  parsed `declarationYear`. The parsed year comes from inside the XML and does
 *  not reliably equal the folder, so keying replacement on it would strand or
 *  clobber the wrong rows.
 *
 *  A STRING, not a number. Folder names are not all integers — `2021_nc` is the
 *  MP 2021 cohort (there is no plain `/2021/`) — and parsing to an int turned it
 *  into NaN, which silently made such a run authoritative for nothing, so
 *  upstream corrections and removals never landed. Comparing segments also gives
 *  `"2021_nc" !== "2021"` for free, which is the distinction the ownership test
 *  needs. */
export const folderFromSourceUrl = (url: string): string | null =>
  registerFolderSegment(url);

/** Merge one run's declarations into a declarant's existing history.
 *
 *  `targetYears` is every register folder year this run is authoritative for —
 *  a single year for the officials ingests, potentially several for the MP one
 *  (`DECL_YEARS` accepts a list). Rows from those years are replaced; rows from
 *  any other year survive untouched. */
export const mergeDeclarations = <T extends DeclarationLike>(
  existing: readonly T[],
  incoming: readonly T[],
  targetFolders: string | readonly string[],
): T[] => {
  const owned = new Set(
    typeof targetFolders === "string" ? [targetFolders] : targetFolders,
  );
  // Drop the rows this run owns, keep every other folder, then add the fresh set.
  const kept = existing.filter((d) => {
    const f = folderFromSourceUrl(d.sourceUrl);
    return f == null || !owned.has(f);
  });
  // Dedupe by sourceUrl across BOTH sides and within `incoming` itself. A
  // duplicate on both sides would double up (a row whose URL carries no
  // parseable folder), and upstream does sometimes list one declaration twice —
  // a merge that cannot heal that leaves the duplicate in place forever.
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const d of incoming) {
    if (seen.has(d.sourceUrl)) continue;
    seen.add(d.sourceUrl);
    merged.push(d);
  }
  for (const d of kept) {
    if (seen.has(d.sourceUrl)) continue;
    seen.add(d.sourceUrl);
    merged.push(d);
  }
  return merged.sort(byRecency);
};
