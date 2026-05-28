// Annual sibling of PeerSnapshotStrip. Reads usePeerIndicatorAnnual and
// renders a one-line BG/EU27/RO/GR/HU/HR snapshot at the latest year both
// BG and each peer report, with a stale-by-≤2-years tolerance per peer.
// Used by indicator cards whose underlying series is annual cadence
// (SILC, demographics, criminal-justice).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  usePeerIndicatorAnnual,
  type PeerGeo,
  type PeerAnnualPoint,
} from "@/data/macro/useMacroPeers";
import { cn } from "@/lib/utils";
import { RankBadge } from "./RankBadge";

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

const pickLatestSnapshot = (
  series: Partial<Record<PeerGeo, PeerAnnualPoint[]>>,
): {
  year: number;
  values: Partial<Record<PeerGeo, { value: number; yearLag: number }>>;
} | null => {
  const bg = series.BG ?? [];
  if (bg.length === 0) return null;
  const bgLatest = bg[bg.length - 1];
  const result: Partial<Record<PeerGeo, { value: number; yearLag: number }>> =
    {};
  for (const geo of STRIP_ORDER) {
    const arr = series[geo] ?? [];
    if (arr.length === 0) continue;
    let bestIdx = -1;
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].year <= bgLatest.year) {
        bestIdx = i;
        break;
      }
    }
    if (bestIdx < 0) continue;
    const point = arr[bestIdx];
    const lag = bgLatest.year - point.year;
    // Tolerate up to 2 years of lag — SILC + criminal-justice series have
    // staggered country releases.
    if (lag > 2) continue;
    result[geo] = { value: point.value, yearLag: lag };
  }
  return { year: bgLatest.year, values: result };
};

export const PeerSnapshotStripAnnual: FC<{
  indicatorKey: string;
  formatValue?: (value: number) => string;
  className?: string;
}> = ({ indicatorKey, formatValue, className }) => {
  const { i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const block = usePeerIndicatorAnnual(indicatorKey);

  if (!block) return null;
  const snapshot = pickLatestSnapshot(block.series);
  if (!snapshot) return null;

  const fmt = formatValue ?? ((v: number) => v.toFixed(1));
  const geoLabel = lang === "bg" ? GEO_LABEL_BG : GEO_LABEL_EN;
  const periodLabel = String(snapshot.year);

  const dist = block.latestDistribution;
  const distAligned = dist != null && dist.year === snapshot.year;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground mb-2",
        className,
      )}
    >
      <span className="font-medium text-foreground">{periodLabel}</span>
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
              v.yearLag > 0
                ? lang === "bg"
                  ? `данни от ${v.yearLag} г. по-рано`
                  : `${v.yearLag} year(s) earlier`
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
          <RankBadge
            rank={dist.rank}
            total={dist.total}
            direction={dist.direction}
          />
        </>
      )}
    </div>
  );
};
