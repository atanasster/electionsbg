// Shared Tailwind class fragment for the amber "warning / context" chip used by
// the sector packs (insight chips in NoiPack / RoadsPack, statutory-context
// chips in NoiStrategicSuppliersTile). Single-sourced so the next pack can't
// fork a fourth slightly-different amber. Layout classes stay at each call site;
// this is only the colour scheme.
export const WARN_CHIP_COLORS =
  "border-amber-300/60 bg-amber-100/50 text-amber-700 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-400";
