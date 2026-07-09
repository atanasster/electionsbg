// "НЗОК плащания по region" — the map the competitor lacks. Colours each oblast
// by НЗОК hospital-care spend, with a per-resident toggle (the normalisation that
// turns raw € into a comparable rate — big oblasti spend more simply because they
// have more people; €/person shows where the fund actually pays more per head).
// Reuses the procurement choropleth scaffolding (Sofia-merged region GeoJSON, d3
// projection, FeatureMap) driven by the per-РЗОК hospital-payments rollup.

import { FC, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Map as MapIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useSofiaMergedRegionsMap } from "@/data/regions/useSofiaMergedRegionsMap";
import { getDataProjection } from "@/screens/components/maps/d3_utils";
import { FeatureMap } from "@/screens/components/maps/FeatureMap";
import { useTooltip } from "@/ux/useTooltip";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { formatEurCompact } from "@/lib/currency";
import { monthYearLabel } from "@/lib/monthNames";
import {
  useNzokRegional,
  type NzokOblastMetric,
} from "@/data/budget/useNzokRegional";
import { featureToCanon } from "@/data/procurement/useProcurementByOblast";
import type { NzokHospitalPaymentsFile } from "@/data/budget/types";

// Health-teal sequential ramp (light → dark), matching the momentum tile.
const RAMP = [
  "hsl(174 40% 92%)",
  "hsl(174 42% 80%)",
  "hsl(174 45% 66%)",
  "hsl(175 50% 50%)",
  "hsl(176 60% 38%)",
  "hsl(178 68% 26%)",
];
const NO_DATA = "hsl(var(--muted))";

export const NzokRegionalChoroplethTile: FC<{
  data: NzokHospitalPaymentsFile;
}> = ({ data }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const mapGeo = useSofiaMergedRegionsMap();
  const { buckets, valueFor } = useNzokRegional(data);
  const [metric, setMetric] = useState<NzokOblastMetric>("perCapita");
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<MapCoordinates | undefined>();
  const { tooltip, onMouseEnter, onMouseMove, onMouseLeave } = useTooltip();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setSize([el.offsetWidth, el.offsetHeight, el.offsetLeft, el.offsetTop]);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const projection = useMemo(
    () =>
      mapGeo && size
        ? getDataProjection(
            mapGeo as Parameters<typeof getDataProjection>[0],
            size,
          )
        : null,
    [mapGeo, size],
  );

  // Percentile thresholds from the per-oblast values (one per bucket, so Sofia's
  // three features don't skew the scale).
  const sorted = useMemo(() => {
    return [...buckets.values()]
      .map((b) =>
        metric === "total"
          ? b.totalEur
          : b.population > 0
            ? b.totalEur / b.population
            : undefined,
      )
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);
  }, [buckets, metric]);

  const colorFor = (v: number | undefined): string => {
    if (v == null || sorted.length === 0) return NO_DATA;
    const rank = sorted.filter((x) => x <= v).length / sorted.length;
    const idx = Math.min(RAMP.length - 1, Math.floor(rank * RAMP.length));
    return RAMP[idx];
  };

  const fmt = (v: number | undefined): string => {
    if (v == null) return "—";
    if (metric === "perCapita")
      return bg
        ? `${formatEurCompact(v, lang)} / чов.`
        : `${formatEurCompact(v, lang)} / person`;
    return formatEurCompact(v, lang);
  };

  const legendValues =
    sorted.length > 0 ? [sorted[0], sorted[sorted.length - 1]] : null;

  if (data.byRzok.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <MapIcon className="h-4 w-4" />
            {bg ? "Болнични плащания по област" : "Hospital payments by region"}
          </CardTitle>
          <div
            className="flex gap-1"
            role="group"
            aria-label={bg ? "Мярка" : "Metric"}
          >
            {(["perCapita", "total"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMetric(m)}
                aria-pressed={m === metric}
                className={`rounded-full border px-2 py-0.5 text-xs font-medium transition-colors ${
                  m === metric
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground hover:text-foreground"
                }`}
              >
                {m === "perCapita"
                  ? bg
                    ? "На човек"
                    : "Per person"
                  : bg
                    ? "Общо"
                    : "Total"}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div ref={ref} className="relative w-full h-[300px] md:h-[340px]">
          {projection && mapGeo ? (
            <svg
              width={size?.[0]}
              height={size?.[1]}
              viewBox={`0 0 ${size?.[0]} ${size?.[1]}`}
              className="overflow-visible"
              role="img"
              aria-label={
                bg
                  ? "Карта на болничните плащания по област"
                  : "Hospital-payments map by region"
              }
            >
              {mapGeo.features.map((feature, idx) => {
                const code = feature.properties.nuts3;
                const canon = featureToCanon(code);
                const v = valueFor(code, metric);
                const b = buckets.get(canon);
                return (
                  <FeatureMap
                    key={`${code}-${idx}`}
                    feature={feature}
                    geoPath={projection.path}
                    fillColor={colorFor(v)}
                    onMouseEnter={(e) =>
                      onMouseEnter(
                        { pageX: e.pageX, pageY: e.pageY },
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium">{b?.name ?? code}</span>
                          <span className="tabular-nums">{fmt(v)}</span>
                          {b ? (
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {formatEurCompact(b.totalEur, lang)}{" "}
                              {bg ? "общо" : "total"}
                            </span>
                          ) : null}
                        </div>,
                      )
                    }
                    onMouseMove={(e) =>
                      onMouseMove({ pageX: e.pageX, pageY: e.pageY })
                    }
                    onMouseLeave={onMouseLeave}
                  />
                );
              })}
            </svg>
          ) : null}
        </div>
        {legendValues && (
          <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="tabular-nums">{fmt(legendValues[0])}</span>
            <div
              className="h-2 flex-1 rounded-sm border border-border/50"
              style={{
                background: `linear-gradient(to right, ${RAMP.join(", ")})`,
              }}
            />
            <span className="tabular-nums">{fmt(legendValues[1])}</span>
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground/80">
          {bg
            ? `Заплатени от НЗОК за болнична помощ по РЗОК (натрупано до ${monthYearLabel(data.month, data.year, lang)}). „На човек“ дели на населението на областта (Eurostat, средногодишно).`
            : `НЗОК hospital-care payments by regional fund (cumulative to ${monthYearLabel(data.month, data.year, lang)}). "Per person" divides by the oblast's population (Eurostat, annual average).`}
        </p>
      </CardContent>
      {tooltip}
    </Card>
  );
};
