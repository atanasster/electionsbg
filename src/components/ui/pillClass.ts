import { cn } from "@/lib/utils";

/**
 * The pill's class string, in its own module so `Pill.tsx` exports only
 * components (react-refresh) — and because a caller that must render its own
 * element still has to look identical. The stories menu's DropdownMenuTrigger
 * is the case: Radix needs the trigger to be its own child.
 */
export type PillSize = "sm" | "md";

const SIZE: Record<PillSize, string> = {
  // The lens row, where a long label set has to fit one line.
  sm: "px-2.5 py-0.5 text-xs",
  md: "px-3.5 py-1.5 text-sm",
};

const base =
  "inline-flex items-center gap-1.5 rounded-full border font-medium transition-colors " +
  // ring-offset-background too: without it Tailwind's default offset colour is
  // #fff, which draws a white band between chip and ring on the dark theme.
  // Every other primitive in this directory pairs the two.
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "focus-visible:ring-offset-1 focus-visible:ring-offset-background";

const state = (selected: boolean): string =>
  selected
    ? "border-accent-strong bg-accent-strong text-accent-strong-foreground"
    : // Hover signals affordance, it does not claim state: adopting the full
      // selected treatment put TWO pills in the selected look at once on a
      // single-select row, with nothing telling them apart.
      "border-foreground/25 bg-secondary/70 text-secondary-foreground " +
      "hover:border-accent-strong hover:bg-accent-strong/10 hover:text-foreground";

export const pillClass = (selected: boolean, size: PillSize = "md"): string =>
  cn(base, SIZE[size], state(selected));
