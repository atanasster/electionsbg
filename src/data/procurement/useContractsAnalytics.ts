// Shared facet-driven analytics for the contracts browsers (the global
// /procurement/contracts browser and the per-entity /company|/awarder screens).
// Owns the /api/db/facets scaffolding both screens duplicated: the procedure-mix
// + bid-count + CPV facets (each excluding its OWN dimension so its options stay
// visible under the other filters), the derived integrity KPIs (single-bidder %,
// direct-award %), the bucket→raw-method translation, and the stale-bucket guard.
//
// The two callers differ only in a few flags:
//   • scope        — an entity scope { col, val } (company/awarder) or none (global)
//   • fixedFilters — the always-applied filters (tag [+ window / awarder EIK-set])
//   • commonFilters— filters applied to EVERY facet, never an excluded dimension
//                    (e.g. the company screen's year range)
//   • reactiveCpv  — whether the CPV facet reflects the active method/single filters
//                    (company: yes) or stays static (global: keep the list stable)
//   • enabled      — stand the analysis facets down when the block is hidden
//                    (the global screen's ?sector pages); the CPV facet still runs.
//
// Cost control: while no procedure/single filter is active the proc-mix and
// bid-count facets share one filter set, so they're fetched in ONE request; once
// either is set they must each exclude their own dimension, which needs two.

import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DbColumnFilter } from "@/ux/data_table/DbDataTable";
import {
  groupMethodFacet,
  type MethodBucketFacet,
  type ProcedureBucket,
} from "@/lib/cpvSectors";
import { facetShare, bucketShare } from "@/lib/facetStats";

type FacetRows = { value: string; count: number }[];
type FacetsResponse = { facets: Record<string, FacetRows> };

export interface ContractsAnalyticsArgs {
  resource: string;
  /** Entity scope (contractor_eik / awarder_eik). Omit for the global corpus. */
  scope?: { col: string; val: string };
  /** Always-applied, non-user-editable filters (tag [+ window / awarder set]). */
  fixedFilters: DbColumnFilter[];
  /** Applied to every facet, never an excluded own-dimension (e.g. a year range). */
  commonFilters?: DbColumnFilter[];
  /** Active single-bidder fragment (excluded from the bid-count facet). */
  singleFilter: DbColumnFilter[];
  /** Active CPV fragment (excluded from the CPV facet when reactiveCpv). */
  cpvFilter: DbColumnFilter[];
  procBucket: ProcedureBucket | null;
  /** When false the analysis facets (proc-mix + bid-count) stand down — KPIs go
   *  null and the mix empties. The CPV facet always runs (it powers a filter). */
  enabled?: boolean;
  /** When true the CPV facet applies the active method/single filters; when false
   *  it's scope-only, so the division list doesn't shift as you pick a procedure. */
  reactiveCpv?: boolean;
  limit?: number;
  /** Called once the loaded facet no longer contains the selected bucket, so the
   *  caller can clear its now-stale procBucket state. */
  onBucketInvalid?: () => void;
}

export interface ContractsAnalytics {
  groupedMethods: MethodBucketFacet[];
  cpvOptions: FacetRows;
  singleBidPct: number | null;
  directPct: number | null;
  /** The procurement_method `in` fragment for the selected bucket (or []). */
  methodF: DbColumnFilter[];
}

export const useContractsAnalytics = ({
  resource,
  scope,
  fixedFilters,
  commonFilters = [],
  singleFilter,
  cpvFilter,
  procBucket,
  enabled = true,
  reactiveCpv = false,
  limit = 100,
  onBucketInvalid,
}: ContractsAnalyticsArgs): ContractsAnalytics => {
  // A combined request asks for several columns under one `limit`; /api/db/facets
  // applies it PER column (top-N distinct values each), not globally — so adding a
  // high-cardinality column to a combined request stays safe for the others.
  const fetchFacets = async (
    columns: string[],
    filters: DbColumnFilter[],
  ): Promise<FacetsResponse> => {
    const req: {
      resource: string;
      scope?: { col: string; val: string };
      fixedFilters: DbColumnFilter[];
      filters: DbColumnFilter[];
      columns: string[];
      limit: number;
    } = { resource, fixedFilters, filters, columns, limit };
    if (scope) req.scope = scope;
    const r = await fetch(
      `/api/db/facets?q=${encodeURIComponent(JSON.stringify(req))}`,
    );
    if (!r.ok) return { facets: {} };
    return r.json();
  };

  const scopeKey = scope ? `${scope.col}:${scope.val}` : "global";
  const bothUnfiltered = !procBucket && singleFilter.length === 0;

  // Combined proc-mix + bid-count facet, fired only while both dimensions are
  // unfiltered (their filter sets coincide then).
  const { data: combinedFacet } = useQuery({
    queryKey: [
      "db-facets",
      resource,
      scopeKey,
      "combined",
      fixedFilters,
      commonFilters,
      cpvFilter,
    ],
    enabled: enabled && bothUnfiltered,
    queryFn: () =>
      fetchFacets(
        ["procurement_method", "number_of_tenderers"],
        [...commonFilters, ...cpvFilter],
      ),
    staleTime: Infinity,
  });
  // Procedure-mix facet (split) — every filter EXCEPT the procedure one.
  const { data: procFacet } = useQuery({
    queryKey: [
      "db-facets",
      resource,
      scopeKey,
      "proc",
      fixedFilters,
      commonFilters,
      singleFilter,
      cpvFilter,
    ],
    enabled: enabled && !bothUnfiltered,
    queryFn: () =>
      fetchFacets(
        ["procurement_method"],
        [...commonFilters, ...singleFilter, ...cpvFilter],
      ),
    staleTime: Infinity,
  });
  const methodRows = bothUnfiltered
    ? combinedFacet?.facets?.procurement_method
    : procFacet?.facets?.procurement_method;
  const groupedMethods = useMemo(
    () => groupMethodFacet(methodRows ?? []),
    [methodRows],
  );
  const selectedMethods = useMemo<string[]>(
    () =>
      procBucket
        ? (groupedMethods.find((g) => g.bucket === procBucket)?.methods ?? [])
        : [],
    [procBucket, groupedMethods],
  );
  const methodF = useMemo<DbColumnFilter[]>(
    () =>
      selectedMethods.length
        ? [{ id: "procurement_method", value: selectedMethods }]
        : [],
    [selectedMethods],
  );

  // If another filter narrows the scoped facet so the selected bucket no longer
  // exists, selectedMethods would silently become [] and the procedure filter
  // would drop while the UI still reads "selected". Signal the caller to clear it.
  // The callback is held in a ref so callers can pass a fresh inline arrow without
  // making this effect re-run every render.
  const onBucketInvalidRef = useRef(onBucketInvalid);
  onBucketInvalidRef.current = onBucketInvalid;
  useEffect(() => {
    if (
      procBucket &&
      groupedMethods.length &&
      !groupedMethods.some((g) => g.bucket === procBucket)
    ) {
      onBucketInvalidRef.current?.();
    }
  }, [procBucket, groupedMethods]);

  // Bid-count facet (split) — every filter EXCEPT single-bid.
  const { data: bidFacet } = useQuery({
    queryKey: [
      "db-facets",
      resource,
      scopeKey,
      "bids",
      fixedFilters,
      commonFilters,
      methodF,
      cpvFilter,
    ],
    enabled: enabled && !bothUnfiltered,
    queryFn: () =>
      fetchFacets(
        ["number_of_tenderers"],
        [...commonFilters, ...methodF, ...cpvFilter],
      ),
    staleTime: Infinity,
  });
  const bidRows = bothUnfiltered
    ? combinedFacet?.facets?.number_of_tenderers
    : bidFacet?.facets?.number_of_tenderers;

  // CPV facet — reactive (excludes its own dimension) or static (scope-only).
  const { data: cpvFacet } = useQuery({
    queryKey: [
      "db-facets",
      resource,
      scopeKey,
      "cpv",
      fixedFilters,
      commonFilters,
      reactiveCpv ? singleFilter : null,
      reactiveCpv ? methodF : null,
    ],
    queryFn: () =>
      fetchFacets(
        ["cpv"],
        reactiveCpv
          ? [...commonFilters, ...singleFilter, ...methodF]
          : [...commonFilters],
      ),
    staleTime: Infinity,
  });
  const cpvOptions = cpvFacet?.facets?.cpv ?? [];

  // Integrity KPIs over the facet's own scope (contracts with a known value):
  // single-bidder share + direct-award share. Null when there's no denominator.
  const singleBidPct = useMemo<number | null>(
    () => facetShare(bidRows ?? [], (v) => Number(v) === 1),
    [bidRows],
  );
  const directPct = useMemo<number | null>(
    () => bucketShare(groupedMethods, "direct"),
    [groupedMethods],
  );

  return {
    groupedMethods,
    cpvOptions,
    singleBidPct,
    directPct,
    methodF,
  };
};
