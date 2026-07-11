// Shared insight-chip row for the procurement sector packs (НОИ, НЗОК, …). Each
// pack computes its own auto-headlines as `{ text, warn? }[]`; this renders the
// identical rounded-pill row they all inlined before (rounded-full border,
// px-2.5 py-1, text-xs font-medium; warn → the single-sourced amber
// WARN_CHIP_COLORS, else the neutral muted pill). Layout is a wrapping flex row;
// renders nothing when there are no items.

import { FC } from "react";
import { WARN_CHIP_COLORS } from "@/screens/components/procurement/chipStyles";

export interface InsightChip {
  text: string;
  warn?: boolean;
}

export const InsightChips: FC<{ items: InsightChip[] }> = ({ items }) => {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it, i) => (
        <span
          key={`${i}-${it.text}`}
          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
            it.warn
              ? WARN_CHIP_COLORS
              : "border-border bg-muted/40 text-foreground"
          }`}
        >
          {it.text}
        </span>
      ))}
    </div>
  );
};
