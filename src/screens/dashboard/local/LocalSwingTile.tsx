// Per-party council-vote swing vs the previous local cycle — direction +
// magnitude (percentage points), the "what changed since last time" read.
// Reuses the cross-cycle series already loaded for the trends tile (no extra
// fetch). Caveat, per the German "Wahlpfeil" convention: an arrow toward a
// party does NOT mean that party won — it's a pure delta.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { useLocalCrossCycle } from "@/data/local/useLocalCrossCycle";
import { StatCard } from "../StatCard";

export const LocalSwingTile: FC<{
  // Top-N preview when set; every party's swing otherwise.
  limit?: number;
  seeMoreTo?: string;
}> = ({ limit, seeMoreTo }) => {
  const { t } = useTranslation();
  // Tile shows a handful of parties; the full page surfaces the long tail.
  const { data } = useLocalCrossCycle(limit != null ? 8 : 60);

  const swing = useMemo(() => {
    if (!data) return null;
    const { cyclesAsc, parties } = data;
    // The two most recent cycles that actually carry a council signal (some
    // cycles ship 0-vote council rows → null points; skip those).
    const signalIdx = cyclesAsc
      .map((_, i) => i)
      .filter((i) => parties.some((p) => p.points[i].councilPct != null));
    if (signalIdx.length < 2) return null;
    const curr = signalIdx[signalIdx.length - 1];
    const prev = signalIdx[signalIdx.length - 2];
    const rows = parties
      .map((p) => {
        const c = p.points[curr].councilPct ?? 0;
        const pr = p.points[prev].councilPct ?? 0;
        return { name: p.displayName, color: p.color, delta: c - pr, curr: c };
      })
      .filter((r) => r.curr > 0 || Math.abs(r.delta) >= 0.1)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    return {
      rows,
      from: cyclesAsc[prev].year,
      to: cyclesAsc[curr].year,
    };
  }, [data]);

  if (!swing || swing.rows.length === 0) return null;

  const rows = limit != null ? swing.rows.slice(0, limit) : swing.rows;

  return (
    <StatCard
      seeMoreTo={seeMoreTo}
      label={t("local_swing_title")}
      hint={t("local_swing_hint", { from: swing.from, to: swing.to })}
    >
      <ul className="flex flex-col divide-y">
        {rows.map((r) => {
          const up = r.delta > 0.05;
          const down = r.delta < -0.05;
          const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
          const tone = up
            ? "text-emerald-600"
            : down
              ? "text-red-600"
              : "text-muted-foreground";
          return (
            <li key={r.name} className="flex items-center gap-2 py-1.5 text-sm">
              <span
                aria-hidden
                className="inline-block size-2.5 shrink-0 rounded-full ring-1 ring-border"
                style={{ backgroundColor: r.color }}
              />
              <span className="min-w-0 flex-1 truncate" title={r.name}>
                {r.name}
              </span>
              <span
                className={`flex shrink-0 items-center gap-0.5 tabular-nums ${tone}`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {r.delta > 0 ? "+" : ""}
                {r.delta.toFixed(1)} pp
              </span>
            </li>
          );
        })}
      </ul>
    </StatCard>
  );
};
