// Colour class for a spend-change figure across the НЗОК health tiles: rising
// spend reads rose (the watchdog direction), falling reads emerald. Includes the
// dark-mode variants so small delta text stays legible on dark backgrounds —
// matching the DeltaBadge convention in RegionalIndicatorsTile. Kept in one place
// so the "rising = rose / falling = emerald" mapping can't drift across the
// momentum / compare / peer-growth / drug tiles.
export const spendDeltaClass = (delta: number): string =>
  delta >= 0
    ? "text-rose-600 dark:text-rose-400"
    : "text-emerald-600 dark:text-emerald-400";
