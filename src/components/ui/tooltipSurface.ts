// Shared visual surface for every floating UI: tooltips (Radix + custom),
// popovers, recharts hover cards, the Sankey tooltip + pinned overlay, map
// hover labels. One class string keeps them in sync — change the look once,
// every floating surface follows.
//
// Variants:
//   • `tooltipSurfaceClass`        — base surface (border + popover bg + shadow)
//   • `tooltipSurfaceCompactClass` — base + small-tooltip padding/text
//   • `tooltipSurfaceClassPanel`   — base + larger padding for pinned panels
//
// Usage: pass via `cn(tooltipSurfaceClass, "...extra...")`.

export const tooltipSurfaceClass =
  "rounded-md border border-border bg-popover text-popover-foreground shadow-lg";

/** Inline hover tooltip: small padding + xs text. Mirrors the size used by
 * shadcn's TooltipContent so swap-in is visual no-op for tooltip triggers. */
export const tooltipSurfaceCompactClass = `${tooltipSurfaceClass} px-3 py-1.5 text-xs`;

/** Pinned detail panel (e.g. the Sankey overlay). Larger rounded corners +
 * padding; uses shadow-xl for the lifted-card effect. */
export const tooltipSurfacePanelClass =
  "rounded-lg border border-border bg-popover text-popover-foreground shadow-xl p-3";
