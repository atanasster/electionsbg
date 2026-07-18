// Shared signal / status pill for the procurement tables (contracts, tenders,
// the tender status column, КЗК appeal chips). One compact chip: tinted by
// `tone`, an optional leading icon, always a single line (never wraps onto two).
// Replaces the copy-pasted RISK_CHIP_BASE + per-flag colour spans that had
// drifted in radius / case / size across the browsers.
//
// Style vs the old chip: smaller (9px), less rounded (rounded-sm, not the full
// pill) and `whitespace-nowrap` so labels like "Финансиране от ЕС" never break.
// Keep table labels short (a couple of words) — the chip does not truncate.

import { FC, ReactNode } from "react";

export type SignalTone =
  | "red"
  | "amber"
  | "emerald"
  | "teal"
  | "rose"
  | "violet"
  | "yellow"
  | "orange"
  | "slate"
  | "fuchsia"
  | "muted";

const TONE: Record<SignalTone, string> = {
  red: "border-red-300 bg-red-100 text-red-900 dark:border-red-900 dark:bg-red-900/40 dark:text-red-100",
  amber:
    "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  emerald:
    "border-emerald-300 bg-emerald-100 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  teal: "border-teal-300 bg-teal-100 text-teal-900 dark:border-teal-900 dark:bg-teal-900/40 dark:text-teal-100",
  rose: "border-rose-300 bg-rose-100 text-rose-900 dark:border-rose-900 dark:bg-rose-900/40 dark:text-rose-100",
  violet:
    "border-violet-300 bg-violet-100 text-violet-900 dark:border-violet-900 dark:bg-violet-900/40 dark:text-violet-100",
  yellow:
    "border-yellow-300 bg-yellow-100 text-yellow-900 dark:border-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-100",
  orange:
    "border-orange-300 bg-orange-100 text-orange-900 dark:border-orange-900 dark:bg-orange-900/40 dark:text-orange-100",
  slate:
    "border-slate-300 bg-slate-100 text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100",
  fuchsia:
    "border-fuchsia-300 bg-fuchsia-100 text-fuchsia-900 dark:border-fuchsia-900 dark:bg-fuchsia-900/40 dark:text-fuchsia-100",
  muted: "border-border bg-muted text-muted-foreground",
};

/** Base class for every signal pill (tone colours are appended). Exported for
 *  the rare caller that needs the raw classes; prefer the component. */
export const SIGNAL_PILL_BASE =
  "inline-flex items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide";

export const SignalPill: FC<{
  tone: SignalTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}> = ({ tone, icon, children, className = "" }) => (
  <span className={`${SIGNAL_PILL_BASE} ${TONE[tone]} ${className}`}>
    {icon}
    {children}
  </span>
);
