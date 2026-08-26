// The /persons facets — `useRegistryFacets` pinned to the `persons` resource.
//
// ⚠️ THE LOGIC AND ITS THREE CONTRACTS LIVE ONCE, in `@/data/registry/useRegistryFacets`. This
// file used to hold them; /companies needed the same hook, and the `bySpec` contract in
// particular (a flat merge is LOSSY when two specs facet one column — measured on this page at
// 162×, the picker reading the KPI spec's answer) is exactly the kind of rule that must not
// exist twice. The public API is unchanged, so no call site moved.

import {
  useRegistryFacets,
  type FacetSpec,
  type RegistryFacets,
  type RegistryFacetsResult,
  type FacetOption,
} from "@/data/registry/useRegistryFacets";

export type { FacetSpec, FacetOption };
/** Retained aliases: the /persons screen and its tests name these. */
export type PersonFacets = RegistryFacets;
export type PersonFacetsResult = RegistryFacetsResult;

export const usePersonFacets = (
  specs: Record<string, FacetSpec>,
): PersonFacetsResult => useRegistryFacets("persons", specs);
