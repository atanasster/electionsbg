import { cn } from "@/lib/utils";

/**
 * The pill's class string, in its own module so `Pill.tsx` exports only
 * components (react-refresh) — and because a caller that must render its own
 * element still has to look identical. The stories menu's DropdownMenuTrigger
 * is the case: Radix needs the trigger to be its own child.
 */
export type PillSize = "sm" | "md";

/**
 * The site has TWO chip languages and they are not interchangeable, so the
 * choice is explicit rather than defaulted — picking it by copy-paste is what
 * let a 4.77:1 pair spread in the first place.
 *
 * - `accent` — the brand coral, for the data hub's view / lens / section rows,
 *   where the chip row IS the page's primary control. White on `--accent-strong`,
 *   5.45:1 light and 11.81:1 dark.
 * - `neutral` — near-black `--primary`, the idiom most registry and filter rows
 *   already use. 15.27:1 light, 11.81:1 dark, i.e. the higher-contrast of the
 *   two; a filter row inside a dense page should not shout louder than the data.
 */
export type PillTone = "accent" | "neutral";

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

const SELECTED: Record<PillTone, string> = {
  accent: "border-accent-strong bg-accent-strong text-accent-strong-foreground",
  neutral: "border-primary bg-primary text-primary-foreground",
};

// Hover signals affordance, it does not claim state: adopting the full selected
// treatment put TWO pills in the selected look at once on a single-select row,
// with nothing telling them apart. The unselected chip also needs a visible
// edge — `--border` on `--card` is 1.22:1, so the old chip had neither a
// boundary nor a fill and did not read as a control at all.
const UNSELECTED: Record<PillTone, string> = {
  accent:
    "border-foreground/25 bg-secondary/70 text-secondary-foreground " +
    "hover:border-accent-strong hover:bg-accent-strong/10 hover:text-foreground",
  neutral:
    "border-foreground/25 bg-secondary/70 text-secondary-foreground " +
    "hover:border-primary hover:bg-primary/10 hover:text-foreground",
};

export const pillClass = (
  selected: boolean,
  tone: PillTone,
  size: PillSize = "md",
): string => cn(base, SIZE[size], selected ? SELECTED[tone] : UNSELECTED[tone]);
