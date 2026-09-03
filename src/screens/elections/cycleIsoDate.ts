// `2026_04_19` → `2026-04-19`.
//
// ⚠ ITS OWN MODULE so `ElectionScopeBar.tsx` exports only components — the react-refresh rule
// the repo enforces. A LOCAL cycle id carries a `_mi` suffix and is deliberately NOT handled
// here: the caller passes that cycle's round-1 date instead, because `2023-10-29-mi` is an
// unparseable string that `formatDate` would pass through verbatim, i.e. the folder id on the
// page.
export const cycleIsoDate = (cycle: string): string =>
  /^\d{4}_\d{2}_\d{2}$/.test(cycle) ? cycle.split("_").join("-") : "";
