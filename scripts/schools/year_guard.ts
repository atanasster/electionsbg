/**
 * Refuse to rewrite data/schools/index.json with fewer ДЗИ / НВО years than the
 * committed copy. build_index.ts reads only the gitignored raw_data caches, and
 * a missing year's CSV is a `skip` warning — so a machine without the cache (or
 * a cache pruned after МОН rotated a resource off data.egov.bg, as the 2022
 * ДЗИ session was on 2026-10-03) would publish an index with that year gone.
 */

type SchoolLike = {
  scoresByYear?: Record<string, unknown>;
  nvoByYear?: Record<string, unknown> | null;
};
type IndexLike = {
  schoolsByObshtina: Record<string, SchoolLike[] | Record<string, SchoolLike>>;
};

const yearsOf = (
  idx: IndexLike,
  key: "scoresByYear" | "nvoByYear",
): Set<number> => {
  const out = new Set<number>();
  for (const ss of Object.values(idx.schoolsByObshtina)) {
    for (const s of Array.isArray(ss) ? ss : Object.values(ss))
      for (const y of Object.keys(s[key] ?? {})) out.add(Number(y));
  }
  return out;
};

export type SchoolYearLoss = { field: "ДЗИ" | "НВО"; lostYears: number[] };

export const findSchoolYearLoss = (
  next: IndexLike,
  committed: IndexLike | undefined,
): SchoolYearLoss[] => {
  if (!committed) return [];
  const out: SchoolYearLoss[] = [];
  for (const [field, key] of [
    ["ДЗИ", "scoresByYear"],
    ["НВО", "nvoByYear"],
  ] as const) {
    const have = yearsOf(next, key);
    const lost = [...yearsOf(committed, key)]
      .filter((y) => !have.has(y))
      .sort((a, b) => a - b);
    if (lost.length) out.push({ field, lostYears: lost });
  }
  return out;
};
