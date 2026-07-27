// Shared facet-driven analytics for the procurement browsers — the contracts
// browsers (global /procurement/contracts + per-entity /company|/awarder) and the
// tenders browser (/procurement/tenders). Owns the /api/db/facets scaffolding they
// duplicated: the procedure-mix + (optional) bid-count + CPV facets (each excluding
// its OWN dimension so its options stay visible under the other filters), the
// derived integrity KPIs, the bucket→raw-method translation, and the stale-bucket
// guard.
//
// The callers differ only in a few flags:
//   • resource     — the DbDataTable registry resource ("contracts" | "tenders")
//   • methodColumn — the procedure column faceted into the mix ("procurement_method"
//                    for contracts, "procedure_type" for tenders)
//   • bidColumn    — the bid-count column driving the single-bidder % KPI; pass null
//                    to disable it (tenders have no bid data at announcement)
//   • shareFacet   — an optional extra bool/enum share KPI, e.g. tenders' EU-funded %
//   • scope        — an entity scope { col, val } (company/awarder) or none (global)
//   • fixedFilters — the always-applied filters (tag [+ window / awarder EIK-set])
//   • commonFilters— filters applied to EVERY facet, never an excluded dimension
//                    (e.g. the company screen's year range)
//   • reactiveCpv  — whether the CPV facet reflects the active method/single filters
//                    (company: yes) or stays static (global/tenders: keep it stable)
//   • enabled      — stand the analysis facets down when the block is hidden
//                    (the ?sector pages); the CPV facet still runs (it powers a filter).
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
  /** The procedure column faceted into the mix. Default "procurement_method". */
  methodColumn?: string;
  /** The bid-count column behind the single-bidder % KPI. Default
   *  "number_of_tenderers"; pass null to disable it (e.g. tenders have no bids). */
  bidColumn?: string | null;
  /** An optional extra share KPI: the % of the filtered set whose `column` facet
   *  value satisfies `match` (e.g. tenders' EU-funded %). */
  shareFacet?: { column: string; match: (value: string) => boolean };
  /** When false the analysis facets (proc-mix + bid-count + share) stand down —
   *  KPIs go null and the mix empties. The CPV facet always runs. */
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
  /** Single-bidder share — null when no denominator or no bidColumn. */
  singleBidPct: number | null;
  directPct: number | null;
  /** The optional shareFacet's share — null when no shareFacet or denominator. */
  sharePct: number | null;
  /** The methodColumn `in` fragment for the selected bucket (or []). */
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
  methodColumn = "procurement_method",
  bidColumn = "number_of_tenderers",
  shareFacet,
  enabled = true,
  reactiveCpv = false,
  limit = 100,
  onBucketInvalid,
}: ContractsAnalyticsArgs): ContractsAnalytics => {
  const hasBid = !!bidColumn;
  const shareColumn = shareFacet?.column;
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

  // Combined facet, fired only while both dimensions are unfiltered (their filter
  // sets coincide then): the proc-mix column plus — when present — the bid-count
  // and share columns, all under one request. When a filter narrows one dimension
  // they split into per-dimension requests below.
  const { data: combinedFacet } = useQuery({
    queryKey: [
      "db-facets",
      resource,
      scopeKey,
      "combined",
      methodColumn,
      bidColumn,
      shareColumn ?? "",
      fixedFilters,
      commonFilters,
      cpvFilter,
    ],
    enabled: enabled && bothUnfiltered,
    queryFn: () =>
      fetchFacets(
        [
          methodColumn,
          ...(hasBid ? [bidColumn as string] : []),
          ...(shareColumn ? [shareColumn] : []),
        ],
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
      methodColumn,
      fixedFilters,
      commonFilters,
      singleFilter,
      cpvFilter,
    ],
    enabled: enabled && !bothUnfiltered,
    queryFn: () =>
      fetchFacets(
        [methodColumn],
        [...commonFilters, ...singleFilter, ...cpvFilter],
      ),
    staleTime: Infinity,
  });
  const methodRows = bothUnfiltered
    ? combinedFacet?.facets?.[methodColumn]
    : procFacet?.facets?.[methodColumn];
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
        ? [{ id: methodColumn, value: selectedMethods }]
        : [],
    [selectedMethods, methodColumn],
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

  // Bid-count facet (split) — every filter EXCEPT single-bid. Only when the
  // resource has a bid column.
  const { data: bidFacet } = useQuery({
    queryKey: [
      "db-facets",
      resource,
      scopeKey,
      "bids",
      bidColumn,
      fixedFilters,
      commonFilters,
      methodF,
      cpvFilter,
    ],
    enabled: enabled && !bothUnfiltered && hasBid,
    queryFn: () =>
      fetchFacets(
        [bidColumn as string],
        [...commonFilters, ...methodF, ...cpvFilter],
      ),
    staleTime: Infinity,
  });
  const bidRows = hasBid
    ? bothUnfiltered
      ? combinedFacet?.facets?.[bidColumn as string]
      : bidFacet?.facets?.[bidColumn as string]
    : undefined;

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

  // Optional share KPI (e.g. EU-funded %) over the FULL active filter set — its
  // column isn't otherwise filtered, so there's no own-dimension to exclude. While
  // unfiltered its filter set coincides with the combined facet's, so it rides
  // that request; a separate query only fires once a filter is set.
  const { data: shareData } = useQuery({
    queryKey: [
      "db-facets",
      resource,
      scopeKey,
      "share",
      shareColumn ?? "",
      fixedFilters,
      commonFilters,
      singleFilter,
      methodF,
      cpvFilter,
    ],
    enabled: enabled && !!shareColumn && !bothUnfiltered,
    queryFn: () =>
      fetchFacets(
        [shareColumn as string],
        [...commonFilters, ...singleFilter, ...methodF, ...cpvFilter],
      ),
    staleTime: Infinity,
  });
  const shareRows = shareColumn
    ? bothUnfiltered
      ? combinedFacet?.facets?.[shareColumn]
      : shareData?.facets?.[shareColumn]
    : undefined;

  // Integrity KPIs over the facet's own scope (rows with a known value):
  // single-bidder share + direct-award share + the optional share. Null when
  // there's no denominator.
  const singleBidPct = useMemo<number | null>(
    () => facetShare(bidRows ?? [], (v) => Number(v) === 1),
    [bidRows],
  );
  const directPct = useMemo<number | null>(
    () => bucketShare(groupedMethods, "direct"),
    [groupedMethods],
  );
  // Left inline (not useMemo'd like its siblings): facetShare is O(rows) cheap and
  // shareFacet is typically a fresh inline object, so memoizing on it would defeat
  // itself. The returned object is recreated every render regardless.
  const sharePct = shareFacet
    ? facetShare(shareRows ?? [], shareFacet.match)
    : null;

  return {
    groupedMethods,
    cpvOptions,
    singleBidPct,
    directPct,
    sharePct,
    methodF,
  };
};
