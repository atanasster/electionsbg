// Small pure helpers for the integrity KPIs computed off /api/db/facets rows.
// Extracted from CompanyContractsDbScreen so the denominator/guard logic is unit
// tested without rendering the screen.
import type { MethodBucketFacet, ProcedureBucket } from "@/lib/cpvSectors";

// Share (%) of facet rows whose value matches `predicate`, over the total of all
// rows (the facet's own scope — rows with a known value for that column). Returns
// null when there is no denominator, so the caller can render "—" rather than a
// misleading 0%.
export const facetShare = (
  rows: { value: string; count: number }[],
  predicate: (value: string) => boolean,
): number | null => {
  const total = rows.reduce((s, r) => s + r.count, 0);
  if (!total) return null;
  const match = rows
    .filter((r) => predicate(r.value))
    .reduce((s, r) => s + r.count, 0);
  return (match / total) * 100;
};

// Share (%) one ProcedureBucket holds of a grouped procedure-method facet. Null
// when the mix is empty.
export const bucketShare = (
  grouped: MethodBucketFacet[],
  bucket: ProcedureBucket,
): number | null => {
  const total = grouped.reduce((s, g) => s + g.count, 0);
  if (!total) return null;
  const n = grouped.find((g) => g.bucket === bucket)?.count ?? 0;
  return (n / total) * 100;
};
