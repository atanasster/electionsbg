// Ownership (state | municipal | private) presentation helpers for the НЗОК
// health pack — labels + chip styling, shared by the payments, momentum, compare
// and risk tiles so the same class reads the same colour everywhere.
//
// Why it matters: "excludes private hospitals" is Диагноза България's biggest
// published gap. We include the private sector AND label it, so every row can
// carry an ownership chip and the payments band can headline the private-vs-
// public split. See src/data/budget/types.ts (NzokOwnership) + migration 065.

import type { NzokOwnership } from "@/data/budget/types";

export type OwnershipKey = NzokOwnership | "unclassified";

// The value of the shared ownership filter — a concrete ownership class or "all".
// Kept here (not inlined per-tile) so the pill-group component and every consumer
// agree on one type. See the <OwnershipFilter> component.
export type OwnershipFilterValue = "all" | NzokOwnership;

export const OWNERSHIP_KEYS: OwnershipKey[] = [
  "state",
  "municipal",
  "private",
  "unclassified",
];

/** Full label ("Държавна" / "State-owned"). */
export const ownershipLabel = (
  o: OwnershipKey | null | undefined,
  bg: boolean,
): string => {
  switch (o) {
    case "state":
      return bg ? "Държавна" : "State";
    case "municipal":
      return bg ? "Общинска" : "Municipal";
    case "private":
      return bg ? "Частна" : "Private";
    default:
      return bg ? "Некласифицирана" : "Unclassified";
  }
};

/** Tailwind classes for a small pill chip. Health-neutral, theme-aware, and
 *  distinct across the four classes (state=slate, municipal=teal, private=amber,
 *  unclassified=muted). */
export const ownershipChipClass = (
  o: OwnershipKey | null | undefined,
): string => {
  switch (o) {
    case "state":
      return "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300";
    case "municipal":
      return "border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-800 dark:bg-teal-900/40 dark:text-teal-300";
    case "private":
      return "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
    default:
      return "border-border bg-muted/40 text-muted-foreground";
  }
};

/** A bar/swatch fill colour (hex) for the split bar, matching the chips. */
export const ownershipColor = (o: OwnershipKey): string => {
  switch (o) {
    case "state":
      return "#64748b"; // slate-500
    case "municipal":
      return "#14b8a6"; // teal-500
    case "private":
      return "#f59e0b"; // amber-500
    default:
      return "#cbd5e1"; // slate-300
  }
};

/** "Публичен" umbrella (state + municipal) vs private, for the one-line headline. */
export const isPublicOwnership = (
  o: OwnershipKey | null | undefined,
): boolean => o === "state" || o === "municipal";
