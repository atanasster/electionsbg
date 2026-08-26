// How a landing card becomes an href — a pure rule, in a module of its own for the reason
// `companiesBrowseConstants.ts` exists: exporting a non-component from a component file breaks
// Fast Refresh (`react-refresh/only-export-components`).

/** Build a card's href by MERGING its one param into the live query string.
 *
 *  ⚠️ MERGE, NEVER REPLACE. `to: "/companies?money=1"` drops every other param the reader is
 *  carrying — `?elections` (live on this page: the OG capture shoots
 *  `companies?political=1&elections=2026_04_19`), `?area`, `?pscope`, and `?scope` itself. It
 *  also DELETES `?scope`, deliberately: a card is a cross-cutting question about the whole
 *  registry, and answering it inside the floored scope would silently drop the rows the card
 *  counted — the counts come from a facet computed WITHOUT the floor. */
export const companyCardHref = (
  current: URLSearchParams,
  param: string,
  value: string,
): string => {
  const next = new URLSearchParams(current);
  next.delete("scope");
  next.delete("browse");
  next.set(param, value);
  return `/companies?${next.toString()}`;
};
