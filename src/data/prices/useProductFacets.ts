// The /consumption/products facets — `useRegistryFacets` pinned to the `price_products`
// resource.
//
// ⚠️ ONE SPEC PER DIMENSION, EACH EXCLUDING ITS OWN FILTER. That is the shared hook's first
// contract and the one this page can actually break: without it, picking „Мляко" collapses the
// Група dropdown to just „Мляко" and the reader cannot switch to another group without
// clearing first.
//
// ⚠️ NO DIMENSION HERE IS FACETED TWICE, so `merged` is safe to read on this page — unlike
// /companies, where `entity_class` feeds both a picker (which must exclude `?class`) and the
// head's evidence aside (which must not), and reading the flat merge handed the second answer
// to both. If a KPI band or an evidence list ever lands on this page over a column a picker
// also facets, switch that read to `bySpec` rather than adding a second spec to the merge.
//
// ⚠️ THE FACETS ARE NOT SCOPED BY THE FREE-TEXT SEARCH. `runDbFacets` calls buildWhere with no
// `global` arm, so a picker's counts describe the CORPUS under the other filters, never the
// term. On this page that is invisible today — the counts sit in the dropdown, beside the
// dimension they enumerate — but any figure derived from them and rendered as prose would have
// to say so.
//
// Vocabulary sizes, measured 2026-08-31 against the 46,682 browsable rows, all far under
// runDbFacets' 500 cap (which drops a vocabulary's RAREST members silently once exceeded):
// `pid` 101 · `net_unit` 4 (three real values plus the empty string) · `unit_priced` 2.

import {
  useRegistryFacets,
  type FacetSpec,
  type RegistryFacets,
  type RegistryFacetsResult,
  type FacetOption,
} from "@/data/registry/useRegistryFacets";

export type { FacetSpec, FacetOption };
export type ProductFacets = RegistryFacets;
export type ProductFacetsResult = RegistryFacetsResult;

export const useProductFacets = (
  specs: Record<string, FacetSpec>,
): ProductFacetsResult => useRegistryFacets("price_products", specs);
