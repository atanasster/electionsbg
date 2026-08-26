// The /companies facets — `useRegistryFacets` pinned to the `companies` resource.
//
// ⚠️ TWO SPECS WILL FACET `entity_class` HERE, AND THEY NEED DIFFERENT ANSWERS. Written in the
// future tense on purpose: the screen wiring lands in a later tier, and a header describing a
// call site that does not exist yet as though it did is how a comment becomes fiction. When it
// lands it is the second live case of the `bySpec` contract, not a hypothetical one:
//
//   · the Вид PICKER's spec must EXCLUDE `?class`, or the dropdown collapses to the option
//     already chosen and the reader cannot switch without clearing first;
//   · the head's EVIDENCE ASIDE („Видове", the seven-row corpus breakdown) must NOT exclude it,
//     because it is a statement about the whole scope rather than about the filtered set.
//
// Both are right, and `Object.assign` hands the second to both in `Object.entries` order. Read
// `bySpec`, never `merged`, for this column. The /persons measurement is the warning:
// `is_company` sat in two specs there and the picker's „Бизнес" row read 526 while clicking it
// returned 85,060.

import {
  useRegistryFacets,
  type FacetSpec,
  type RegistryFacets,
  type RegistryFacetsResult,
  type FacetOption,
} from "@/data/registry/useRegistryFacets";

export type { FacetSpec, FacetOption };
export type CompanyFacets = RegistryFacets;
export type CompanyFacetsResult = RegistryFacetsResult;

export const useCompanyFacets = (
  specs: Record<string, FacetSpec>,
): CompanyFacetsResult => useRegistryFacets("companies", specs);
