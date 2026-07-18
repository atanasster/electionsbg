// Shared strip of signal pills — the one place that maps a list of signals to
// `<Tooltip><SignalPill/></Tooltip>` chips in a wrapping row, with an optional
// "+N" overflow chip (mobile row-height guard) and a dash when empty. Extracted
// from the copy-pasted chip loops in TenderRiskChips / RiskBadges / the NGO
// signal pills so they can't drift. Callers build the per-signal meta (tone /
// icon / label / tooltip); this owns only the layout + overflow + empty state.

import { FC, ReactNode } from "react";
import { Tooltip } from "@/ux/Tooltip";
import { SignalPill, SignalTone } from "./SignalPill";

export type SignalPillItem = {
  /** Stable React key (usually the signal code). */
  key: string;
  tone: SignalTone;
  icon?: ReactNode;
  label: ReactNode;
  /** Tooltip body; when omitted the pill renders without a tooltip. */
  tooltip?: ReactNode;
};

export const SignalPillStrip: FC<{
  items: SignalPillItem[];
  /** Truncate to N pills, then a muted "+M" overflow chip. Omit to show all. */
  maxVisible?: number;
  /** Render an em dash when there are no items (default true). */
  emptyDash?: boolean;
  className?: string;
}> = ({ items, maxVisible, emptyDash = true, className = "" }) => {
  if (items.length === 0)
    return emptyDash ? (
      <span className="text-xs text-muted-foreground">—</span>
    ) : null;

  const shown =
    maxVisible != null && items.length > maxVisible
      ? items.slice(0, maxVisible)
      : items;
  const hidden = items.length - shown.length;

  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      {shown.map((it) => {
        const pill = (
          <SignalPill tone={it.tone} icon={it.icon}>
            {it.label}
          </SignalPill>
        );
        return it.tooltip ? (
          <Tooltip key={it.key} content={it.tooltip}>
            {pill}
          </Tooltip>
        ) : (
          <span key={it.key}>{pill}</span>
        );
      })}
      {hidden > 0 ? <SignalPill tone="muted">+{hidden}</SignalPill> : null}
    </div>
  );
};
