// Peer-growth percentile strip — the transparent alternative to the competitor's
// black-box "AI anomaly" flag. Places one hospital's year-over-year НЗОК spend
// growth in the national distribution: "spend +X% YoY — faster-growing than N% of
// hospitals", with a percentile track marking where it sits against the median.
// The formula is published in the footnote; nothing is hidden. Pure from
// NzokHospitalMomentum.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { spendDeltaClass } from "@/lib/spendDelta";
import type { NzokHospitalMomentum } from "@/data/budget/types";

// Percentile bands — a fast-growing outlier (top decile) gets the watchdog
// colour, the upper quartile an amber nudge, the rest stays neutral.
const bandColor = (pct: number): string => {
  if (pct >= 0.9) return "bg-rose-600 dark:bg-rose-500";
  if (pct >= 0.75) return "bg-amber-500 dark:bg-amber-400";
  return "bg-slate-400 dark:bg-slate-500";
};

export const NzokPeerGrowthStrip: FC<{ m: NzokHospitalMomentum }> = ({ m }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const grew = m.yoyDelta >= 0;
  const pctPeers = Math.round(m.percentile * 100);
  const fmtPct = (v: number, signed = false) =>
    `${signed && v > 0 ? "+" : ""}${(v * 100).toLocaleString(i18n.language, {
      maximumFractionDigits: 1,
    })}%`;
  const markerLeft = `${Math.min(98, Math.max(2, m.percentile * 100))}%`;

  return (
    <div className="rounded-lg border bg-muted/30 p-2.5 space-y-1.5">
      <div className="text-xs">
        {bg ? "Разходът " : "Spend "}
        <span className={`font-semibold ${spendDeltaClass(m.yoyDelta)}`}>
          {grew
            ? bg
              ? `нарасна с ${fmtPct(m.yoyDelta, true)}`
              : `grew ${fmtPct(m.yoyDelta, true)}`
            : bg
              ? `намаля с ${fmtPct(Math.abs(m.yoyDelta))}`
              : `fell ${fmtPct(Math.abs(m.yoyDelta))}`}
        </span>{" "}
        {bg
          ? `на годишна база — над ${pctPeers}% от болниците по темп на нарастване`
          : `year-over-year — faster-growing than ${pctPeers}% of hospitals`}
      </div>

      {/* Percentile track: 0% (slowest) → 100% (fastest). Marker = this hospital;
          the dashed line is the median hospital. */}
      <div className="relative h-2 w-full rounded-full bg-gradient-to-r from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-600">
        {/* Median hospital sits at the 50th percentile by definition. */}
        <div
          className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-foreground/40"
          style={{ left: "50%" }}
          aria-hidden
        />
        <div
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background shadow"
          style={{ left: markerLeft }}
          aria-hidden
        >
          <div
            className={`h-full w-full rounded-full ${bandColor(m.percentile)}`}
          />
        </div>
      </div>

      <div className="flex items-center justify-between text-[10px] text-muted-foreground/80">
        <span>{bg ? "по-бавен ръст" : "slower growth"}</span>
        <span>
          {bg ? "медиана" : "median"} {fmtPct(m.medianDelta, true)} ·{" "}
          {m.peerCount} {bg ? "болници" : "hospitals"}
        </span>
        <span>{bg ? "по-бърз ръст" : "faster growth"}</span>
      </div>
    </div>
  );
};
