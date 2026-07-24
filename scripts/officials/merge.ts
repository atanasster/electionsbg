// Officials-specific merge helpers. The generic per-declarant declaration merge
// lives in scripts/lib/declaration_merge.ts and is shared with the MP ingest —
// see there for the semantics. What stays here is the index-entry merge, which
// only the officials roster has.
//
// Kept out of ./index.ts on purpose: that module calls run() at import time, so
// it cannot be imported from a test.

import type { OfficialIndexEntry } from "../../src/data/dataTypes";

export {
  folderFromSourceUrl,
  mergeDeclarations,
} from "../lib/declaration_merge";

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
