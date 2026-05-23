// One-line snapshot above each peer-aware chart on /indicators. Reads
// "Q1 2026 · BG 2.4%   EU 2.3%   RO 4.1%   GR 2.8%   HU 4.6%   HR 3.1%   rank 14/27"
// where the rank pill is hidden for indicators whose direction is ambiguous
// (current account, house prices).
//
// Pulls from useMacroPeers / usePeerIndicator and lays out as a single line
// that wraps on narrow viewports.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  usePeerIndicator,
  type PeerGeo,
  type PeerQuarterlyPoint,
} from "@/data/macro/useMacroPeers";
import { cn } from "@/lib/utils";

// Display order on the strip. BG anchors; EU27 next as the headline
// benchmark; then the four peers grouped (RO + GR neighbors, HU + HR CEE).
const STRIP_ORDER: PeerGeo[] = ["BG", "EU27_2020", "RO", "GR", "HU", "HR"];

const GEO_LABEL_EN: Record<PeerGeo, string> = {
  BG: "BG",
  EU27_2020: "EU",
  RO: "RO",
  GR: "GR",
  HU: "HU",
  HR: "HR",
};

const GEO_LABEL_BG: Record<PeerGeo, string> = {
  BG: "БГ",
  EU27_2020: "ЕС",
  RO: "РО",
  GR: "ГР",
  HU: "УН",
  HR: "ХР",
};

// Pick the most recent period where BG has a value, then read each peer's
// matching point. Peers that don't report at that exact quarter fall back to
// their most recent prior point (≤4 quarters back) — keeps the strip
// populated for series with patchy peer coverage (e.g. house prices in GR).
const pickLatestSnapshot = (
  series: Partial<Record<PeerGeo, PeerQuarterlyPoint[]>>,
): {
  period: string;
  values: Partial<Record<PeerGeo, { value: number; periodLag: number }>>;
} | null => {
  const bg = series.BG ?? [];
  if (bg.length === 0) return null;
  const bgLatest = bg[bg.length - 1];
  const result: Partial<Record<PeerGeo, { value: number; periodLag: number }>> =
    {};
  for (const geo of STRIP_ORDER) {
    const arr = series[geo] ?? [];
    if (arr.length === 0) continue;
    // Find the latest point that is ≤ bgLatest. Stale-by-≤4 quarters is
    // acceptable; older than that we drop rather than mislead.
    let bestIdx = -1;
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      if (
        p.year < bgLatest.year ||
        (p.year === bgLatest.year && p.quarter <= bgLatest.quarter)
      ) {
        bestIdx = i;
        break;
      }
    }
    if (bestIdx < 0) continue;
    const point = arr[bestIdx];
    const lag =
      (bgLatest.year - point.year) * 4 + (bgLatest.quarter - point.quarter);
    if (lag > 4) continue;
    result[geo] = { value: point.value, periodLag: lag };
  }
  return { period: bgLatest.period, values: result };
};

export const PeerSnapshotStrip: FC<{
  indicatorKey: string;
  /** Formatter for each numeric value (defaults to one-decimal %). */
  formatValue?: (value: number) => string;
  /** Optional className for the wrapping element. */
  className?: string;
}> = ({ indicatorKey, formatValue, className }) => {
  const { i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const block = usePeerIndicator(indicatorKey);

  if (!block) return null;
  const snapshot = pickLatestSnapshot(block.series);
  if (!snapshot) return null;

  const fmt = formatValue ?? ((v: number) => `${v.toFixed(1)}%`);
  const geoLabel = lang === "bg" ? GEO_LABEL_BG : GEO_LABEL_EN;

  // "Q1 2026" → localized
  const formatPeriod = (period: string): string => {
    const m = /^(\d{4})-Q([1-4])$/.exec(period);
    if (!m) return period;
    return lang === "bg" ? `${m[2]} тр. ${m[1]}` : `${m[1]} Q${m[2]}`;
  };

  const dist = block.latestDistribution;
  // Only surface the rank pill when the EU27-distribution snapshot is from
  // the same quarter as the BG headline value — mixing periods would mislead
  // ("BG is rank 5 today" but the rank actually came from last quarter).
  const distAligned = dist != null && dist.period === snapshot.period;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground mb-2",
        className,
      )}
    >
      <span className="font-medium text-foreground">
        {formatPeriod(snapshot.period)}
      </span>
      <span className="opacity-50">·</span>
      {STRIP_ORDER.map((geo) => {
        const v = snapshot.values[geo];
        if (!v) return null;
        const isBg = geo === "BG";
        return (
          <span
            key={geo}
            className={cn(
              "inline-flex items-baseline gap-1",
              isBg ? "font-semibold text-foreground" : "",
            )}
            title={
              v.periodLag > 0
                ? lang === "bg"
                  ? `данни от ${v.periodLag} тр. по-рано`
                  : `${v.periodLag} quarters earlier`
                : undefined
            }
          >
            <span className="opacity-70">{geoLabel[geo]}</span>
            <span className="tabular-nums">{fmt(v.value)}</span>
          </span>
        );
      })}
      {distAligned && dist && (
        <>
          <span className="opacity-50">·</span>
          <span
            className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-muted/40 text-foreground"
            title={
              lang === "bg"
                ? dist.direction === "lower"
                  ? "позиция 1 = най-ниската стойност (по-ниско е по-добре)"
                  : "позиция 1 = най-високата стойност (по-високо е по-добре)"
                : dist.direction === "lower"
                  ? "rank 1 = lowest value (lower is better)"
                  : "rank 1 = highest value (higher is better)"
            }
          >
            {lang === "bg" ? "позиция" : "rank"}{" "}
            <span className="font-semibold tabular-nums ml-0.5">
              {dist.rank}/{dist.total}
            </span>
          </span>
        </>
      )}
    </div>
  );
};
