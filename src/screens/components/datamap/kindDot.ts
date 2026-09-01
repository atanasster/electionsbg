import type { DataMapKind } from "@/data/dataMap/useDataMap";

/**
 * Kind → dot colour, in its own module because THREE files read it: the graph's
 * own node cards, the detail panel's chips, and the screen's head strip, which
 * labels the same three tiers. A second copy would let the legend and the graph
 * disagree about what a colour means — the failure `LENS_LEGEND` is derived for
 * on the lens side, and the failure this module was extracted for. The node
 * card carried a byte-identical private copy until 2026-09-02;
 * `dataMapLayout.test.ts` now holds the one-definition rule so it cannot come
 * back.
 */
export const KIND_DOT: Record<DataMapKind, string> = {
  source: "bg-[hsl(var(--muted-foreground))]",
  dataset: "bg-[hsl(var(--chart-2))]",
  feature: "bg-[hsl(var(--accent))]",
};
