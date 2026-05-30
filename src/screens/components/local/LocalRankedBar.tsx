// Shared local-elections ranked-list primitives.
//
// PartyChip  — colour dot + party name + optional suffix (count / pct).
// RankedBar  — a horizontal bar (svg-free) where width = value / leaderValue,
//              used identically for "mayors won" and "council vote share"
//              across the national + region dashboards.

import { FC } from "react";
import { formatThousands } from "@/data/utils";

export const PartyChip: FC<{
  name: string;
  color: string;
  suffix?: string;
}> = ({ name, color, suffix }) => (
  <span className="flex items-center gap-1.5 min-w-0">
    <span
      aria-hidden
      className="inline-block size-2 rounded-full ring-1 ring-border shrink-0"
      style={{ backgroundColor: color }}
    />
    <span className="font-semibold truncate" title={name}>
      {name}
    </span>
    {suffix ? (
      <span className="text-xs text-muted-foreground font-normal shrink-0">
        {suffix}
      </span>
    ) : null}
  </span>
);

export const RankedBar: FC<{
  label: string;
  value: number;
  pct: number;
  leaderValue: number;
  color: string;
  suffix?: string;
}> = ({ label, value, pct, leaderValue, color, suffix }) => {
  const widthPct = leaderValue > 0 ? (value / leaderValue) * 100 : 0;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_56px_64px] gap-2 items-center py-1.5">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            aria-hidden
            className="inline-block size-2 rounded-full ring-1 ring-border shrink-0"
            style={{ backgroundColor: color }}
          />
          <span className="text-sm truncate" title={label}>
            {label}
          </span>
        </div>
        <div className="mt-1 h-1 rounded bg-muted overflow-hidden">
          <div
            className="h-full"
            style={{ width: `${widthPct}%`, backgroundColor: color }}
          />
        </div>
      </div>
      <div className="text-right text-sm tabular-nums font-medium">
        {formatThousands(value)}
        {suffix ?? ""}
      </div>
      <div className="text-right text-xs tabular-nums text-muted-foreground">
        {pct.toFixed(2)}%
      </div>
    </li>
  );
};
