// Per-oblast procurement choropleth. A generic value-map (unlike RegionsMap,
// which is wired to election votes): it reuses the shared region GeoJSON
// (regions_map.json), the d3 projection helper, and the FeatureMap path
// primitive, but colours each oblast by a procurement metric. The colour scale
// is percentile-based so Sofia's dominant total doesn't wash out the rest.

import { FC, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Map as MapIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useRegionsMap } from "@/data/regions/useRegionsMap";
import { getDataProjection } from "@/screens/components/maps/d3_utils";
import { FeatureMap } from "@/screens/components/maps/FeatureMap";
import { useTooltip } from "@/ux/useTooltip";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { formatEur } from "@/lib/currency";
import {
  useProcurementByOblast,
  type OblastMetric,
} from "@/data/procurement/useProcurementByOblast";

// Light → dark terracotta ramp (6 buckets), matching the procurement palette.
const RAMP = ["#f3e3d3", "#e6c19b", "#d99a5b", "#c2710c", "#97560a", "#5f3705"];
const NO_DATA = "hsl(var(--muted))";

const METRICS: OblastMetric[] = ["total", "perCapita", "avg"];

export const ProcurementChoroplethTile: FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mapGeo = useRegionsMap();
  const { buckets, valueFor } = useProcurementByOblast();
  const [metric, setMetric] = useState<OblastMetric>("total");
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

  // Percentile thresholds from the per-oblast values (one per oblast, not per
  // feature — so Sofia's three features don't skew the distribution).
  const sorted = useMemo(() => {
    const vals = [...buckets.values()]
      .map((b) =>
        metric === "total"
          ? b.totalEur
          : metric === "avg"
            ? b.contractCount > 0
              ? b.totalEur / b.contractCount
              : undefined
            : b.population > 0
              ? b.totalEur / b.population
              : undefined,
      )
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);
    return vals;
  }, [buckets, metric]);

  const colorFor = (v: number | undefined): string => {
    if (v == null || sorted.length === 0) return NO_DATA;
    const rank = sorted.filter((x) => x <= v).length / sorted.length;
    const idx = Math.min(RAMP.length - 1, Math.floor(rank * RAMP.length));
    return RAMP[idx];
  };

  const fmt = (v: number | undefined): string => {
    if (v == null) return "—";
    if (metric === "perCapita") return `${formatEur(v)}/чов.`;
    return formatEur(v);
  };

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <MapIcon className="h-4 w-4" />
          {t("procurement_map_title") || "Local procurement by oblast"}
          <div className="ml-auto flex gap-1">
            {METRICS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMetric(m)}
                className={`rounded-full border px-2 py-0.5 text-xs ${
                  metric === m
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {t(`procurement_map_metric_${m}`) || m}
              </button>
            ))}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div ref={ref} className="relative w-full h-[360px] md:h-[440px]">
          {projection && mapGeo ? (
            <svg
              width={size?.[0]}
              height={size?.[1]}
              viewBox={`0 0 ${size?.[0]} ${size?.[1]}`}
              className="overflow-visible"
              role="img"
              aria-label="Procurement by oblast"
            >
              {mapGeo.features.map((feature, idx) => {
                const code = (feature.properties as { nuts3: string }).nuts3;
                const v = valueFor(code, metric);
                const b = buckets.get(
                  code === "S23" || code === "S24" || code === "S25"
                    ? "SOFIA_CITY"
                    : code === "PDV-00"
                      ? "PDV"
                      : code,
                );
                return (
                  <FeatureMap
                    key={`${code}-${idx}`}
                    feature={feature}
                    geoPath={projection.path}
                    fillColor={colorFor(v)}
                    onClick={() => navigate("/procurement/by-settlement")}
                    onMouseEnter={(e) =>
                      onMouseEnter(
                        { pageX: e.pageX, pageY: e.pageY },
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium">{b?.name ?? code}</span>
                          <span className="tabular-nums">{fmt(v)}</span>
                          {b ? (
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {b.contractCount.toLocaleString("bg-BG")}{" "}
                              {t("procurement_map_contracts") || "contracts"}
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
        <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{t("procurement_map_low") || "lower"}</span>
          <div className="flex">
            {RAMP.map((c) => (
              <span
                key={c}
                className="h-3 w-5"
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <span>{t("procurement_map_high") || "higher"}</span>
          <span className="ml-auto">
            {t("procurement_map_caveat") ||
              "Local-tier buyers only; national ministries excluded."}
          </span>
        </div>
      </CardContent>
      {tooltip}
    </Card>
  );
};
