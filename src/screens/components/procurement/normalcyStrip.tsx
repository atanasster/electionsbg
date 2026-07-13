// Shared presentational pieces for the "how typical is this…?" normalcy panels
// (contracts — 063/064, and tenders — 066). Pure/dumb: a percentile ruler, a
// verdict chip, and the metric-row layout. Kept in one place so the contract and
// tender panels render identical rulers.

import { FC, ReactNode, type CSSProperties } from "react";
import type { NormalcyDir } from "@/data/procurement/useContractNormalcy";

// A flag colour shared by the deviation chips + summary badge — amber, not red:
// this is a signal to look, not a finding of wrongdoing.
export const FLAG_CLS =
  "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300";
export const AMBER_ZONE = "rgba(245, 158, 11, 0.16)";
export const AMBER_DOT = "#d97706";

// Percentile ruler: the cohort's middle 50% is the grey band, the median a tick,
// the risk tail (weaker-competition side) an amber wash, and this row's subject a
// dot at its true cohort percentile. A ruler, not a value axis — so a
// heavy-tailed distribution never squishes the band; the value + median are shown
// in text. CSS-positioned (not SVG) so the marker stays a true circle at any width.
const pctStr = (p: number) =>
  `${(Math.max(0, Math.min(1, p)) * 100).toFixed(2)}%`;

export const Strip: FC<{
  percentile: number;
  dir: NormalcyDir;
  risk: boolean;
}> = ({ percentile, dir, risk }) => (
  <div className="relative h-5 w-full">
    {dir !== "neutral" ? (
      <div
        className="absolute top-1/2 h-3.5 -translate-y-1/2 rounded-sm"
        style={{
          left: dir === "low" ? 0 : pctStr(0.9),
          width: pctStr(0.1),
          background: AMBER_ZONE,
        }}
      />
    ) : null}
    <div
      className="absolute top-1/2 h-px -translate-y-1/2"
      style={{ left: 0, right: 0, background: "hsl(var(--border))" }}
    />
    <div
      className="absolute top-1/2 h-px -translate-y-1/2"
      style={{
        left: pctStr(0.1),
        width: pctStr(0.8),
        background: "hsl(var(--muted-foreground) / 0.45)",
      }}
    />
    <div
      className="absolute top-1/2 h-2 -translate-y-1/2 rounded"
      style={{
        left: pctStr(0.25),
        width: pctStr(0.5),
        background: "hsl(var(--primary) / 0.18)",
      }}
    />
    <div
      className="absolute top-1/2 h-3.5 w-px -translate-y-1/2"
      style={{ left: pctStr(0.5), background: "hsl(var(--muted-foreground))" }}
    />
    <div
      className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2"
      style={
        {
          left: pctStr(Math.max(0.02, Math.min(0.98, percentile))),
          background: risk ? AMBER_DOT : "hsl(var(--primary))",
          // ring blends the dot into the card so it reads as a marker on the line
          "--tw-ring-color": "hsl(var(--card))",
        } as CSSProperties
      }
    />
  </div>
);

export const Chip: FC<{ label: string; flag?: boolean }> = ({
  label,
  flag,
}) => (
  <span
    className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${
      flag ? FLAG_CLS : "bg-muted text-muted-foreground"
    }`}
  >
    {label}
  </span>
);

// One metric row: label + value + a muted median sub-line on the left (own line,
// never mid-wrap), the ruler in the middle, the verdict chip on the right.
export const MetricRow: FC<{
  icon: ReactNode;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  strip: ReactNode;
  chip: ReactNode;
  pctTitle?: string;
}> = ({ icon, label, value, sub, strip, chip, pctTitle }) => (
  <div className="grid grid-cols-[10.5rem_1fr_auto] items-center gap-3 py-2.5">
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-sm font-medium leading-tight tabular-nums">
        {value}
      </div>
      {sub ? (
        <div className="text-[11px] text-muted-foreground tabular-nums">
          {sub}
        </div>
      ) : null}
    </div>
    <div title={pctTitle}>{strip}</div>
    <div className="justify-self-end">{chip}</div>
  </div>
);
