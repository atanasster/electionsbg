// Income & wealth distribution comparison for the EU compare dashboard —
// three SILC indicators side-by-side per peer: Gini coefficient,
// S80/S20 income quintile share ratio, and AROPE (at-risk-of-poverty-or-
// social-exclusion rate). All three are "lower is better" so a single
// colour-coding rule applies. BG ranks at or near 27/27 on each, which is
// the editorial point this tile is here to make visible.
//
// Layout: compact 3-row × N-column grid keyed by visible peers. Mirrors
// PeerSnapshotTable's styling so the dashboard reads as a coherent set.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  usePeerIndicatorAnnual,
  type PeerGeo,
} from "@/data/macro/useMacroPeers";
import { cn } from "@/lib/utils";
import { RankBadge } from "@/screens/components/macro/RankBadge";
import { Flag } from "./Flag";
import {
  GEO_SHORT_BG,
  GEO_SHORT_EN,
  usePeerSelection,
} from "./usePeerSelection";
import { pickByYear, useCompareSnapshotYear } from "./useElectionYear";

type Metric = {
  key: string; // matches indicatorsAnnual key in macro_peers.json
  i18nTitleKey: string;
  format: (v: number) => string;
};

const METRICS: Metric[] = [
  {
    key: "gini",
    i18nTitleKey: "eu_compare_inequality_gini",
    format: (v) => v.toFixed(1),
  },
  {
    key: "incomeQuintileRatio",
    i18nTitleKey: "eu_compare_inequality_s80_s20",
    format: (v) => v.toFixed(2),
  },
  {
    key: "arope",
    i18nTitleKey: "eu_compare_inequality_arope",
    format: (v) => `${v.toFixed(1)}%`,
  },
];

const MetricRow: FC<{
  metric: Metric;
  geos: PeerGeo[];
  lang: "bg" | "en";
  electionYear: number;
}> = ({ metric, geos, lang, electionYear }) => {
  const block = usePeerIndicatorAnnual(metric.key);
  const { t } = useTranslation();
  const title = t(metric.i18nTitleKey);

  // Compare each peer against the EU27 value at (or ≤) the selected election
  // year. Lower is better for all three SILC metrics so the rule is uniform.
  const euValue = useMemo(() => {
    if (!block) return null;
    return pickByYear(block.series.EU27_2020, electionYear)?.value ?? null;
  }, [block, electionYear]);

  if (!block) {
    return (
      <>
        <div className="text-foreground font-medium">{title}</div>
        <div className="text-muted-foreground/80">—</div>
        {geos.map((g) => (
          <div key={g} className="text-right text-muted-foreground">
            —
          </div>
        ))}
        <div />
      </>
    );
  }

  const bgPt = pickByYear(block.series.BG, electionYear);
  const periodLabel = bgPt ? bgPt.period : "—";
  const dist = block.latestDistribution;
  // Rank badge only renders when BG's resolved year matches the rank
  // snapshot year. For historical elections the snapshot lags, so the
  // badge hides rather than displaying a current rank against a past value.
  const distAligned =
    dist != null && bgPt != null && dist.period === bgPt.period;

  const colorClass = (geo: PeerGeo, v: number): string => {
    if (geo === "EU27_2020" || euValue == null) return "";
    const epsilon = 0.1;
    if (Math.abs(v - euValue) < epsilon) return "";
    return v < euValue
      ? "text-emerald-700 dark:text-emerald-400"
      : "text-rose-700 dark:text-rose-400";
  };

  return (
    <>
      <div className="text-foreground font-medium truncate" title={title}>
        {title}
      </div>
      <div className="text-muted-foreground/80 tabular-nums">{periodLabel}</div>
      {geos.map((geo) => {
        const pt = pickByYear(block.series[geo], electionYear);
        const isBg = geo === "BG";
        const color = pt ? colorClass(geo, pt.value) : "";
        // For annual SILC peers can lag BG by a year — note it on hover.
        const lag = pt && bgPt ? bgPt.year - pt.year : 0;
        return (
          <div
            key={geo}
            className={cn(
              "tabular-nums text-right",
              isBg ? "font-semibold" : "",
              color
                ? color
                : isBg
                  ? "text-foreground"
                  : "text-muted-foreground",
            )}
            title={
              pt && lag > 0
                ? lang === "bg"
                  ? `данни от ${lag} г. по-рано`
                  : `${lag} year(s) earlier`
                : undefined
            }
          >
            {pt ? metric.format(pt.value) : "—"}
          </div>
        );
      })}
      <div className="text-right">
        {distAligned && dist ? (
          <RankBadge
            rank={dist.rank}
            total={dist.total}
            direction={dist.direction}
            label=""
            className="tabular-nums"
          />
        ) : null}
      </div>
    </>
  );
};

export const EuCompareInequalityPanel: FC = () => {
  const { i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { geos } = usePeerSelection();
  const electionYear = useCompareSnapshotYear();
  const geoLabel = lang === "bg" ? GEO_SHORT_BG : GEO_SHORT_EN;

  return (
    // Same scroll-fade pattern as PeerSnapshotTable so users on narrow
    // viewports see that the grid extends past the right edge.
    <div className="overflow-x-auto [mask-image:linear-gradient(to_right,black_0,black_calc(100%-24px),transparent_100%)] md:[mask-image:none]">
      <div
        className="grid gap-x-3 gap-y-0.5 text-[11px] items-baseline w-max min-w-full"
        style={{
          gridTemplateColumns: `minmax(140px, max-content) minmax(56px, max-content) repeat(${geos.length}, minmax(48px, 1fr)) minmax(0, max-content)`,
        }}
      >
        {/* Header row */}
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70" />
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70" />
        {geos.map((g) => (
          <div
            key={g}
            className={cn(
              "text-[10px] uppercase tracking-wide flex items-center justify-end gap-1",
              g === "BG"
                ? "text-foreground/70 font-semibold"
                : "text-muted-foreground/70",
            )}
          >
            <Flag geo={g} size={10} title={geoLabel[g]} />
            {geoLabel[g]}
          </div>
        ))}
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70 text-right">
          {lang === "bg" ? "позиция" : "rank"}
        </div>

        {METRICS.map((m) => (
          <MetricRow
            key={m.key}
            metric={m}
            geos={geos}
            lang={lang}
            electionYear={electionYear}
          />
        ))}
      </div>
    </div>
  );
};
