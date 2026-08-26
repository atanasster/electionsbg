// Facet options for a registry browser's filter row — /persons, /companies, and any browser
// that follows. Generic over the resource; each page wraps it with its own.
//
// Server-side paging means the page never holds every row, so the dropdown vocabularies cannot
// come from the rows on screen — they come from /api/db/facets over the whole (scoped) table.
// The alternative, a hardcoded list, both misses newly-added sources and offers options that
// match nothing: /persons' role vocabulary alone is ~54 codes and growing.
//
// THREE CONTRACTS THIS FILE EXISTS TO KEEP:
//
//  1. A FACET EXCLUDES ITS OWN DIMENSION. Otherwise picking "Кмет" collapses the role dropdown
//     to just "Кмет" and the reader cannot switch to anything else without clearing first.
//     runDbFacets documents this ("the caller EXCLUDES a facet's own dimension from its filter
//     set") and useContractsAnalytics implements it; each facet here therefore gets its OWN
//     request with its own filter subset.
//  2. The facets are NOT scoped by the free-text search — the dropdowns describe the corpus,
//     the table describes the query. `runDbFacets` calls buildWhere with `{ columns }` and no
//     `global`, so this is the engine's shape rather than a choice, and it is why every
//     facet-derived KPI cell must declare that it does not follow the search.
//  3. TWO SPECS MAY FACET ONE COLUMN, AND THE FLAT MERGE CANNOT SERVE BOTH. See `bySpec`.

import { useQueries } from "@tanstack/react-query";
import type { DbColumnFilter } from "@/ux/data_table/DbDataTable";

export interface FacetOption {
  /** ⚠️ NOT ALWAYS A STRING, and typing it as one hid a live defect. `runDbFacets` returns the
   *  column's own JSON value, so a `bool` column comes back as a real boolean — measured
   *  against the live route, `is_official_linked` is
   *  `[{"value":false,…},{"value":true,"count":17675}]`. (node-postgres serialises PG `bool`
   *  as a boolean and PG `numeric` as a string, so the two are not even consistent with each
   *  other.) Declared `string`, a consumer writes `b.value === "true"`, matches nothing, and
   *  publishes 0 where 17,675 belongs — with no type error and no runtime error.
   *
   *  Widened so the narrowing has to be deliberate: a consumer feeding this into a
   *  `RegistryFilterOption` (whose `value` really is the string a Radix item carries) must
   *  `String()` it, and one testing a boolean has to say so. */
  value: string | number | boolean;
  count: number;
}

export type RegistryFacets = Record<string, FacetOption[]>;

/** A facet bucket's value as the STRING a filter, a label lookup or a Radix item needs.
 *
 *  ⚠️ USE THIS RATHER THAN A BARE CAST. `FacetOption.value` is deliberately wide because the
 *  engine returns the column's own JSON value, and the one time that was papered over as
 *  `string` it produced a silent zero on a headline figure (see FacetOption). Routing every
 *  narrowing through one named helper means a boolean column's `true`/`false` become "true"
 *  and "false" consistently — which is what `?political=1`-style filters and `t()` keys expect
 *  — instead of each call site inventing its own coercion. */
export const facetKey = (v: FacetOption["value"]): string => String(v);

const fetchFacets = async (
  resource: string,
  columns: readonly string[],
  filters: DbColumnFilter[],
): Promise<RegistryFacets> => {
  const req = {
    resource,
    columns,
    filters,
    // The server's maximum (runDbFacets clamps at 500).
    //
    // ⚠️ FITTING UNDER IT IS A REQUIREMENT OF EVERY CALLER, NOT AN OBSERVATION ABOUT ANY ONE
    // OF THEM — and this module, being generic, can no longer name the vocabularies. It used
    // to say "every vocabulary THIS FILE requests fits", which was true of /persons (289
    // obshtini, 270 courts, 141 parties, 54 roles) and is not a statement the shared hook can
    // make. runDbFacets orders by COUNT, so a vocabulary exceeding the cap silently loses its
    // RAREST members — exactly the options a reader is least likely to notice missing and most
    // likely to be hunting for. Measured for /companies: entity_class 7, status 4, oblast_name
    // 28, obshtina_code 265 — all clear. A dimension that outgrows 500 needs a scoped facet
    // (the way /persons' court picker restricts to judicial rows) or a searchable combobox,
    // never a silently shorter list.
    limit: 500,
  };
  const r = await fetch(
    `/api/db/facets?q=${encodeURIComponent(JSON.stringify(req))}`,
  );
  // ⚠️ THROW, NEVER `return {}`. With `staleTime: Infinity` a resolved empty object is cached
  // as a SUCCESS for the life of the session, so one 500 — or one cold-start timeout — blanks
  // every picker on the page permanently, and React Query never retries because nothing failed.
  // Throwing makes it an error: React Query retries, and `results[i]?.data ?? {}` below still
  // hands consumers the same empty map in the meantime, so no call site changes.
  if (!r.ok) throw new Error(`facets ${resource}: ${r.status} ${r.statusText}`);
  const body = (await r.json()) as { facets?: RegistryFacets };
  return body.facets ?? {};
};

/** One dimension's facet request: the columns to group by, and the filters to apply —
 *  which must EXCLUDE whatever filter this dimension itself owns. */
export interface FacetSpec {
  columns: readonly string[];
  filters: DbColumnFilter[];
}

export interface RegistryFacetsResult {
  /** Every spec's buckets in one flat map, for the columns only one spec requests. */
  merged: RegistryFacets;
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
  bySpec: Record<string, RegistryFacets>;
}

/** Run each dimension's facet as its own query. Keyed on its own filter subset, so
 *  changing the role filter re-fetches the party facet (correctly narrowed) without
 *  re-fetching the role facet (which must stay wide). */
export const useRegistryFacets = (
  /** The `db_table.js` registry resource these facets are over ("persons", "companies"). Part
   *  of the query key, so two pages' facets cannot share a cache entry. */
  resource: string,
  specs: Record<string, FacetSpec>,
): RegistryFacetsResult => {
  const entries = Object.entries(specs);
  const results = useQueries({
    queries: entries.map(([key, spec]) => ({
      queryKey: [
        "db-facets",
        resource,
        key,
        spec.columns,
        spec.filters,
      ] as const,
      queryFn: () => fetchFacets(resource, spec.columns, spec.filters),
      staleTime: Infinity,
    })),
  });
  // ⚠️ FRESH OBJECTS EVERY RENDER, deliberately un-memoised — but say so, because a consumer
  // that wraps a child in React.memo on these props gets nothing. Memoising here would need a
  // dependency on `results`, whose own identity changes each render, so the memo would be a
  // no-op with extra machinery. If a filter bar ever re-renders expensively, memoise at the
  // CONSUMER on the values it actually reads.
  const merged: RegistryFacets = {};
  const bySpec: Record<string, RegistryFacets> = {};
  entries.forEach(([key], i) => {
    const data = results[i]?.data ?? {};
    bySpec[key] = data;
    Object.assign(merged, data);
  });
  return { merged, bySpec };
};
