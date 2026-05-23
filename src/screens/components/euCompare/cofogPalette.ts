// Fixed colour-per-function palette for the EU compare COFOG small-multiples.
// Codes appear in the same colour across every country bar so the reader's
// eye can track "health" (GF07) or "social protection" (GF10) across the
// six geos without re-checking the legend each time. Colours are chosen for
// distinguishability across light + dark themes — the Tailwind chart vars
// only define 5 hues so the additional 5 use named Tailwind shades.

import type { CofogCode } from "@/data/macro/useCofog";

export const COFOG_FUNCTION_COLOR: Record<
  Exclude<CofogCode, "TOTAL">,
  string
> = {
  GF01: "#94a3b8", // General services — slate
  GF02: "#64748b", // Defence — slate-darker
  GF03: "#a78bfa", // Public order — violet
  GF04: "#f59e0b", // Economic affairs — amber
  GF05: "#34d399", // Environment — emerald
  GF06: "#fb923c", // Housing — orange
  GF07: "#10b981", // Health — green (intentionally bold; this is the headline-delta function for BG)
  GF08: "#f472b6", // Culture/religion — pink
  GF09: "#3b82f6", // Education — blue
  GF10: "#6366f1", // Social protection — indigo
};

// Drawing order: top-of-stack to bottom-of-stack. We put the high-spend
// functions (social, health, education) at the BOTTOM so the eye reads
// the most consequential slices closer to the x-axis baseline.
export const COFOG_STACK_ORDER: ReadonlyArray<Exclude<CofogCode, "TOTAL">> = [
  "GF02",
  "GF03",
  "GF05",
  "GF06",
  "GF08",
  "GF01",
  "GF04",
  "GF09",
  "GF07",
  "GF10",
];
