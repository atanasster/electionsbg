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

/** Build an EVIDENCE-RAIL href — the same merge, but KEEPING the scope.
 *
 *  ⚠️ THE OPPOSITE OF `companyCardHref` ON EXACTLY ONE PARAM, and the difference is the whole
 *  reason this is a second function rather than a flag nobody would think about.
 *
 *  A rail row's COUNT is computed under the active scope, so its LINK must be too — otherwise
 *  „фирма 67 456" under `?scope=signal` opens 988,644 rows. Measured over the seven
 *  `entity_class` rows: фирма 67,456 → 988,644 · кооперация 890 → 2,708 · клон на чуждестранно
 *  лице 32 → 878 · държавно предприятие 15 → 23. Four of seven. And the floored scope is what
 *  the landing's PRIMARY button sets, so it is the common path rather than an edge.
 *
 *  ⚠️ THE SCOPE HAS TO BE WRITTEN EXPLICITLY, not merely left in the current search.
 *  `usePreserveParams`' allowlist is `elections · recount · view · party_tabs · summary · area ·
 *  pscope` — no `scope` — and `HubHead` runs every `to` through it, so an ambient `?scope=signal`
 *  is STRIPPED on the way out while a link's own params survive.
 *
 *  The CARDS are right to drop it, which is why they use the other function: all four card
 *  populations imply `has_signal` (0 counterexamples, measured), so their counts are the same
 *  either side of the floor. `entity_class` implies nothing of the sort. */
export const companyEvidenceHref = (
  current: URLSearchParams,
  scope: "all" | "signal",
  param: string,
  value: string,
): string => {
  const next = new URLSearchParams(current);
  next.delete("browse");
  if (scope === "signal") next.set("scope", "signal");
  else next.delete("scope");
  next.set(param, value);
  return `/companies?${next.toString()}`;
};
