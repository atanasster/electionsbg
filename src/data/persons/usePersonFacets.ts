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
    // 320 > every vocabulary here (289 obshtina codes is the largest), so nothing falls off
    // the end. runDbFacets orders by count, so a lower cap would silently drop the RAREST
    // options — exactly the ones a reader is least likely to notice missing, and most
    // likely to be hunting for.
    limit: 320,
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

/** Run each dimension's facet as its own query. Keyed on its own filter subset, so
 *  changing the role filter re-fetches the party facet (correctly narrowed) without
 *  re-fetching the role facet (which must stay wide). */
export const usePersonFacets = (specs: Record<string, FacetSpec>) => {
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
  for (const r of results) Object.assign(merged, r.data ?? {});
  return merged;
};
