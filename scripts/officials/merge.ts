// Officials-specific merge helpers. The generic per-declarant declaration merge
// lives in scripts/lib/declaration_merge.ts and is shared with the MP ingest —
// see there for the semantics. What stays here is the index-entry merge, which
// only the officials roster has.
//
// Kept out of ./index.ts on purpose: that module calls run() at import time, so
// it cannot be imported from a test.

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
// Generic over the entry shape because the MUNICIPAL roster needs the identical
// rule and must not carry a second copy of it: the municipal index was a
// single-year snapshot until 2026-08-14, so the register's first councillor
// turnover deleted 334 officials from the roster, orphaned 408 of their filings
// (person_id NULL) and left 321 /person URLs resolving to nobody. Same defect
// the magistrate roster had, same fix — accumulate, and let the consumer that
// needs the sitting bench filter on descriptorYear.
export const mergeIndexEntries = <
  T extends { slug: string; name: string; descriptorYear?: number },
>(
  existing: T[],
  incoming: T[],
): T[] => {
  const bySlug = new Map<string, T>();
  for (const e of existing) bySlug.set(e.slug, e);
  for (const e of incoming) {
    const prior = bySlug.get(e.slug);
    // A row predating this field has no descriptorYear; treat it as older than
    // anything a current run produces so the first re-derive replaces it. The
    // `>=` on the incoming side is what makes a re-run of the SAME year update
    // descriptors in place rather than no-op.
    if (!prior || (e.descriptorYear ?? 0) >= (prior.descriptorYear ?? 0)) {
      bySlug.set(e.slug, e);
    }
  }
  return [...bySlug.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "bg"),
  );
};

export const mergeYears = (existing: number[], targetYear: number): number[] =>
  [...new Set([...existing, targetYear])].sort((a, b) => a - b);
