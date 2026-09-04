// The ONE fold for comparing a кметство's name against a settlement's.
//
// ⚠ FIVE BYTE-IDENTICAL COPIES OF THIS EXISTED, and two of them are load-bearing on each
// other: `useLocalSettlement` folds `settlement.name` against `kmetstvoName` to decide whether
// a settlement HAS a кметство race at all, and `LocalSettlementDashboardCards` folds the same
// name against each chmi event's `kmetstvoName` to decide whether a by-election SUPERSEDED it —
// then combines both into `featuredKmetstvo`. A divergence between those two does not degrade;
// it attributes one village's by-election to another, on a page that names a person as its
// mayor.
//
// ⚠ `normalize("NFC")` PRECEDES `toLowerCase()` DELIBERATELY. A decomposed `й` (U+0438 U+0306)
// lower-cases to a different string from the composed one, so a copy that dropped the
// normalize — or ordered it after — would silently stop matching every settlement whose name
// carries one, which is a large share of them.
//
// The precedent is `councilNameKey()` (CLAUDE.md): the same fold written twice, diverging on
// `й`→`и` and on hyphens, cost 4,899 of 28,214 council votes their attribution. Five copies is
// that risk five-fold, which is why this module exists rather than a comment asking for care.

/** Case-, whitespace- and composition-insensitive key for кметство ↔ settlement name matching. */
export const kmetstvoNameKey = (s: string): string =>
  s.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
