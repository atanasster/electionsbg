// Facet options for the /persons filter row.
//
// Server-side paging means the page never holds every row, so the dropdown vocabularies
// cannot come from the rows on screen — they come from /api/db/facets over the whole
// (scoped) table. The alternative, a hardcoded list, both misses newly-added sources and
// offers options that match nothing: the role vocabulary alone is ~54 codes and growing.
//
// TWO CONTRACTS THIS FILE EXISTS TO KEEP:
//
//  1. A FACET EXCLUDES ITS OWN DIMENSION. Otherwise picking "Кмет" collapses the role
//     dropdown to just "Кмет" and the reader cannot switch to anything else without
//     clearing first. runDbFacets documents this ("the caller EXCLUDES a facet's own
//     dimension from its filter set") and useContractsAnalytics implements it; each facet
//     here therefore gets its OWN request with its own filter subset.
//  2. The facets are NOT scoped by the free-text search — the dropdowns describe the
//     corpus, the table describes the query. Same split the contracts browser documents.
//  3. TWO SPECS MAY FACET ONE COLUMN, AND THE FLAT MERGE CANNOT SERVE BOTH. See `bySpec`.

import { useQueries } from "@tanstack/react-query";
import type { DbColumnFilter } from "@/ux/data_table/DbDataTable";

export interface FacetOption {
  value: string;
  count: number;
}

export type PersonFacets = Record<string, FacetOption[]>;

const fetchFacets = async (
  columns: readonly string[],
  filters: DbColumnFilter[],
): Promise<PersonFacets> => {
  const req = {
    resource: "persons",
    columns,
    filters,
    // The server's maximum (runDbFacets clamps at 500). Every vocabulary this file requests
    // fits under it — 289 obshtini, 270 courts, 141 parties, 54 roles — and that is a
    // REQUIREMENT, not an observation: runDbFacets orders by count, so a vocabulary
    // exceeding the cap loses its RAREST members, which are exactly the options a reader is
    // least likely to notice missing and most likely to be hunting for. A dimension that
    // outgrows 500 needs a scoped facet (the way the court picker restricts to judicial
    // rows) or a searchable combobox — never a silently shorter list.
    limit: 500,
  };
  const r = await fetch(
    `/api/db/facets?q=${encodeURIComponent(JSON.stringify(req))}`,
  );
  if (!r.ok) return {};
  const body = (await r.json()) as { facets?: PersonFacets };
  return body.facets ?? {};
};

/** One dimension's facet request: the columns to group by, and the filters to apply —
 *  which must EXCLUDE whatever filter this dimension itself owns. */
export interface FacetSpec {
  columns: readonly string[];
  filters: DbColumnFilter[];
}

export interface PersonFacetsResult {
  /** Every spec's buckets in one flat map, for the columns only one spec requests. */
  merged: PersonFacets;
  /** Each spec's OWN buckets, keyed by spec name.
   *
   *  ⚠️ NOT A CONVENIENCE — THE FLAT MERGE IS LOSSY AND SILENTLY SO. Two specs may facet the
   *  SAME column with deliberately different filter sets, and both be right: a VOCABULARY
   *  excludes its own dimension (or the picker collapses to the option already chosen), while a
   *  DENOMINATOR includes it (or the rate stops describing the rows on screen). `Object.assign`
   *  then hands the second to both, in `Object.entries` order, with nothing to show for it.
   *
   *  Measured on /persons, where `is_company` is in both `groups` and `kpis`: at `?facet=mp`
   *  the Група picker's „Бизнес" row read **526** (is_company ∧ is_mp) while clicking it
   *  returned **85 060** — 162× — because the picker was reading the KPI spec's answer. A
   *  consumer that needs a particular spec's reading must name it. */
  bySpec: Record<string, PersonFacets>;
}

/** Run each dimension's facet as its own query. Keyed on its own filter subset, so
 *  changing the role filter re-fetches the party facet (correctly narrowed) without
 *  re-fetching the role facet (which must stay wide). */
export const usePersonFacets = (
  specs: Record<string, FacetSpec>,
): PersonFacetsResult => {
  const entries = Object.entries(specs);
  const results = useQueries({
    queries: entries.map(([key, spec]) => ({
      queryKey: [
        "db-facets",
        "persons",
        key,
        spec.columns,
        spec.filters,
      ] as const,
      queryFn: () => fetchFacets(spec.columns, spec.filters),
      staleTime: Infinity,
    })),
  });
  const merged: PersonFacets = {};
  const bySpec: Record<string, PersonFacets> = {};
  entries.forEach(([key], i) => {
    const data = results[i]?.data ?? {};
    bySpec[key] = data;
    Object.assign(merged, data);
  });
  return { merged, bySpec };
};
