// One procurement choropleth for a single metric. Presentational sibling of
// ProcurementChoroplethTile, which renders three of these as dashboard tiles
// (small multiples) instead of one map with metric toggle buttons.
//
// Thin wrapper over the generic OblastChoropleth (§3.1d extraction): it maps the
// procurement buckets to the generic {canon → value} shape for the selected
// metric and supplies the procurement ramp + euro formatter. All the geometry
// (Sofia-merge, projection, percentile colour, tooltip, click-to-filter) lives
// in OblastChoropleth, shared with the culture / water maps.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { formatEur } from "@/lib/currency";
import {
  useProcurementByOblast,
  type OblastMetric,
} from "@/data/procurement/useProcurementByOblast";
import { PROCUREMENT_RAMP } from "@/screens/components/procurement/procurementPalette";
import { OblastChoropleth } from "@/screens/components/procurement/OblastChoropleth";

export const ProcurementOblastMap: FC<{
  metric: OblastMetric;
  /** Canonical bucket code of the oblast currently filtering the table. */
  activeCanon?: string | null;
  /** Fired with the canonical code + display name of a clicked oblast. */
  onSelectOblast?: (canon: string, name: string) => void;
}> = ({ metric, activeCanon, onSelectOblast }) => {
  const { t } = useTranslation();
  const { buckets } = useProcurementByOblast();

  // One value per oblast for the selected metric (kept identical to the previous
  // per-metric logic: total €, avg per contract, or € per resident).
  const { values, names } = useMemo(() => {
    const values = new Map<string, number | undefined>();
    const names = new Map<string, string>();
    for (const [canon, b] of buckets) {
      names.set(canon, b.name);
      const v =
        metric === "total"
          ? b.totalEur
          : metric === "avg"
            ? b.contractCount > 0
              ? b.totalEur / b.contractCount
              : undefined
            : b.population > 0
              ? b.totalEur / b.population
              : undefined;
      values.set(canon, v);
    }
    return { values, names };
  }, [buckets, metric]);

  const fmt = (v: number | undefined): string => {
    if (v == null) return "—";
    if (metric === "perCapita")
      return `${formatEur(v)}${t("procurement_map_per_resident_unit") || "/cap"}`;
    return formatEur(v);
  };

  return (
    <OblastChoropleth
      values={values}
      names={names}
      ramp={PROCUREMENT_RAMP}
      formatValue={fmt}
      tooltipExtra={(canon) => {
        const b = buckets.get(canon);
        return b
          ? `${b.contractCount.toLocaleString("bg-BG")} ${t("procurement_map_contracts") || "contracts"}`
          : null;
      }}
      activeCanon={activeCanon}
      onSelectOblast={onSelectOblast}
      ariaLabel={t(`procurement_map_metric_${metric}`) || metric}
    />
  );
};
