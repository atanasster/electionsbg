// The basis LADDER every registry-browser head band walks, and the constant it echoes with.
//
// Extracted because two browsers were walking it separately and had ALREADY drifted:
// `/procurement/contracts` counted a whitespace-only term as a search (`!!term`) while
// /persons did not (`!!term?.trim()`), so two pages that are meant to read as one system
// disagreed about what a search is. The drift was invisible — each file's own test pinned its
// own behaviour.
//
// What is NOT extracted, deliberately: the truth table. WHICH cells render, and which are
// withheld because the reader has already determined their answer, is genuinely per-resource —
// contracts withholds a single-bid rate under `?single=1`, persons withholds a declaration
// rate under the private scope. Folding those together would produce a rule with a union of
// both resources' inputs and neither's clarity.
//
// THE LADDER'S ONE LOAD-BEARING RULE: `rateBasis` does NOT follow the search, and says so.
// `/api/db/facets` has no free-text parameter at all — `runDbFacets` calls buildWhere with
// `{ columns }` and no `global` — so every facet-derived figure keeps describing the filtered
// CORPUS while the row count moves with the search box. That is not a bug to fix in a band; it
// is a sentence the band must not publish without qualifying.

/** A term is echoed back into a 10 px uppercase line, so it is clamped. A free-text param
 *  accepts 200 characters; measured on the contracts band, a pasted contract title took the
 *  head from 149 px to 413 px. */
export const TERM_MAX = 24;

export interface BasisLadderInput {
  /** The DEBOUNCED term the row figures were computed under. */
  term?: string;
  /** Whether any dimension other than the always-present scope is engaged. */
  filtered: boolean;
  /** What to say when neither a search nor a filter is in play — the window, the scope, the
   *  period. Already formatted, because only the caller knows what its always-on dimension is. */
  windowBasis: string;
  t: (k: string, o?: Record<string, unknown>) => string;
  /** i18n keys, so each resource keeps its own wording. */
  keys: { matching: string; filters: string; filtersNotSearch: string };
}

export interface BasisLadder {
  /** For a figure that follows EVERY dimension, search included. */
  rowBasis: string;
  /** For a figure that follows the filters and NOT the search. */
  rateBasis: string;
  /** Whether a term is actually in play — a whitespace-only term is not a search. */
  searching: boolean;
  /** The term as it will be echoed: trimmed and clamped. */
  shownTerm: string;
}

export const basisLadder = ({
  term,
  filtered,
  windowBasis,
  t,
  keys,
}: BasisLadderInput): BasisLadder => {
  const trimmed = (term ?? "").trim();
  const searching = trimmed.length > 0;
  const shownTerm = trimmed.slice(0, TERM_MAX);
  return {
    searching,
    shownTerm,
    rowBasis: searching
      ? t(keys.matching, { term: shownTerm })
      : filtered
        ? t(keys.filters)
        : windowBasis,
    // NEVER the window caption while searching: „62% от всички 137 461 лица" printed under a
    // heading that says 321 is a totality claim about a set the reader is not looking at.
    rateBasis: searching
      ? t(keys.filtersNotSearch)
      : filtered
        ? t(keys.filters)
        : windowBasis,
  };
};
