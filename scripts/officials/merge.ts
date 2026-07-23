// Merge helpers for the officials ingest.
//
// A run targets ONE register folder year, but data/officials/ accumulates
// every year ingested so far. Without merging, a backfill would overwrite each
// per-slug file with the older year and shrink index.json to that year's
// cohort — index.json is a shared universe file (funds political-links,
// company-connections, NGO board links, person resolution all read it), so
// that would silently narrow several downstream builds.
//
// Semantics: a run is AUTHORITATIVE FOR ITS TARGET YEAR and additive
// elsewhere. Re-running a year replaces exactly that year's rows (so upstream
// corrections and removals land) and leaves every other year untouched, which
// makes re-runs idempotent.
//
// Kept out of ./index.ts on purpose: that module calls run() at import time,
// so it cannot be imported from a test.

import type {
  OfficialDeclaration,
  OfficialIndexEntry,
} from "../../src/data/dataTypes";
import { registerFolderYear } from "../lib/cacbg_register";

// Which run owns a row: the register folder it came from, NOT
// decl.declarationYear. The parsed year comes from inside the XML and does not
// reliably equal the folder, so keying replacement on it would strand or
// clobber the wrong rows.
//
// Bare years only — see registerFolderYear's `allowSuffixed` note for why the
// ownership test and the dating test must differ.
export const folderYearFromSourceUrl = (url: string): number | null =>
  registerFolderYear(url);

// Newest first, with deterministic tie-breaks so re-running an unchanged year
// reproduces byte-identical output.
const byRecency = (a: OfficialDeclaration, b: OfficialDeclaration): number =>
  b.declarationYear - a.declarationYear ||
  (b.filedAt ?? "").localeCompare(a.filedAt ?? "") ||
  (a.entryNumber ?? "").localeCompare(b.entryNumber ?? "") ||
  a.sourceUrl.localeCompare(b.sourceUrl);

export const mergeDeclarations = (
  existing: OfficialDeclaration[],
  incoming: OfficialDeclaration[],
  targetYear: number,
): OfficialDeclaration[] => {
  // Drop the rows this run owns, keep every other year, then add the fresh set.
  const kept = existing.filter(
    (d) => folderYearFromSourceUrl(d.sourceUrl) !== targetYear,
  );
  // Guard against a duplicate sourceUrl surviving on both sides (a row whose
  // URL doesn't carry a parseable folder year would otherwise double up).
  const incomingUrls = new Set(incoming.map((d) => d.sourceUrl));
  const merged = [
    ...kept.filter((d) => !incomingUrls.has(d.sourceUrl)),
    ...incoming,
  ];
  return merged.sort(byRecency);
};

// One entry per slug. The richer descriptors (category, institution, position)
// only exist on the list.xml side, so a slug last seen in an older run keeps
// the descriptors from the newest run that saw it.
//
// Precedence is the REGISTER FOLDER YEAR the run targeted — `descriptorYear` —
// not the parsed `latestDeclarationYear`. Keying on the latter was circular and
// self-wedging: it is derived from the filings, so a row written by a buggy
// parser could claim a year no run could ever beat. That is exactly what
// happened — 434 rows carried a wall-clock 2026, and once the parser was fixed
// to clamp every year to its folder, no re-derive could ever replace them. The
// stale category, institution and position title would have outlived every
// backfill.
//
// A `--year 2015` backfill still cannot clobber 2025 descriptors, which is the
// property the original rule was reaching for.
export const mergeIndexEntries = (
  existing: OfficialIndexEntry[],
  incoming: OfficialIndexEntry[],
): OfficialIndexEntry[] => {
  const bySlug = new Map<string, OfficialIndexEntry>();
  for (const e of existing) bySlug.set(e.slug, e);
  for (const e of incoming) {
    const prior = bySlug.get(e.slug);
    // A row predating this field has no descriptorYear; treat it as older than
    // anything a current run produces so the first re-derive replaces it.
    if (!prior || e.descriptorYear >= (prior.descriptorYear ?? 0)) {
      bySlug.set(e.slug, e);
    }
  }
  return [...bySlug.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "bg"),
  );
};

export const mergeYears = (existing: number[], targetYear: number): number[] =>
  [...new Set([...existing, targetYear])].sort((a, b) => a - b);
