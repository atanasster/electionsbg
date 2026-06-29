// Hero map for the АПИ road dashboard: the BG motorway network drawn over a
// faint oblast basemap, each corridor coloured by the selected metric
// (€/km median, or single-bidder share for the integrity lens). Reuses the d3
// projection helper + oblast GeoJSON; road geometry is the static OSM ingest.

import { FC, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSofiaMergedRegionsMap } from "@/data/regions/useSofiaMergedRegionsMap";
import { useRoadGeometry } from "@/data/procurement/useRoadGeometry";
import { getDataProjection } from "@/screens/components/maps/d3_utils";
import { useTooltip } from "@/ux/useTooltip";
import type { MapCoordinates } from "@/layout/dataview/MapLayout";
import { formatEur, formatEurCompact } from "@/lib/currency";
import type { CorridorAgg } from "@/data/procurement/roadAttributes";

export type RoadMetric = "perKm" | "singleBid";

// Low → high ramp (teal → amber → red). Higher = more expensive / higher risk.
const RAMP = ["#0F6E56", "#1D9E75", "#EF9F27", "#D85A30", "#A32D2D"];
const NO_DATA = "#B4B2A9";

const valueOf = (c: CorridorAgg, metric: RoadMetric): number | undefined =>
  metric === "perKm" ? c.eurPerKmMedian : c.singleBidShare;

export const RoadNetworkMap: FC<{
  corridors: CorridorAgg[];
  metric: RoadMetric;
}> = ({ corridors, metric }) => {
  const { i18n } = useTranslation();
  const mapGeo = useSofiaMergedRegionsMap();
  const { data: geo } = useRoadGeometry();
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

  // Corridor name → aggregate, and the value range for the colour scale.
  const byName = useMemo(() => {
    const m = new Map<string, CorridorAgg>();
    for (const c of corridors) m.set(c.corridor, c);
    return m;
  }, [corridors]);

  const range = useMemo(() => {
    const vals: number[] = [];
    for (const c of corridors) {
      const v = valueOf(c, metric);
      if (v != null) vals.push(v);
    }
    if (vals.length === 0) return null;
    return [Math.min(...vals), Math.max(...vals)] as const;
  }, [corridors, metric]);

  const colorForCorridor = (name: string): string => {
    const c = byName.get(name);
    const v = c ? valueOf(c, metric) : undefined;
    if (v == null || !range) return NO_DATA;
    const [lo, hi] = range;
    const f = hi > lo ? (v - lo) / (hi - lo) : 0.5;
    return RAMP[Math.min(RAMP.length - 1, Math.floor(f * RAMP.length))];
  };

  const fmtVal = (name: string): string => {
    const c = byName.get(name);
    const v = c ? valueOf(c, metric) : undefined;
    if (v == null) return i18n.language === "bg" ? "няма данни" : "no data";
    return metric === "perKm"
      ? `${formatEurCompact(v, i18n.language)}/km`
      : `${(v * 100).toLocaleString(i18n.language, { maximumFractionDigits: 0 })}%`;
  };

  return (
    <>
      <div ref={ref} className="relative w-full h-[300px] md:h-[360px]">
        {projection && mapGeo && geo ? (
          <svg
            width={size?.[0]}
            height={size?.[1]}
            viewBox={`0 0 ${size?.[0]} ${size?.[1]}`}
            className="overflow-visible"
            role="img"
            aria-label={
              i18n.language === "bg"
                ? "Магистрална мрежа по коридори"
                : "Motorway network by corridor"
            }
          >
            {/* Faint oblast basemap. */}
            {mapGeo.features.map((feature, idx) => (
              <path
                key={`bm-${idx}`}
                d={
                  projection.path(
                    feature as Parameters<typeof projection.path>[0],
                  ) ?? undefined
                }
                fill="hsl(var(--muted))"
                fillOpacity={0.35}
                stroke="hsl(var(--border))"
                strokeWidth={0.5}
              />
            ))}
            {/* Motorway corridors. */}
            {geo.features.map((f, idx) => (
              <path
                key={`rd-${idx}`}
                d={
                  projection.path(f as Parameters<typeof projection.path>[0]) ??
                  undefined
                }
                fill="none"
                stroke={colorForCorridor(f.properties.corridor)}
                strokeWidth={
                  f.properties.class === "АМ"
                    ? 2.6
                    : f.properties.class === "I"
                      ? 1.7
                      : 1.1
                }
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ cursor: "pointer" }}
                onMouseEnter={(e) =>
                  onMouseEnter(
                    { pageX: e.pageX, pageY: e.pageY },
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">
                        {f.properties.corridor}{" "}
                        <span className="text-muted-foreground">
                          {f.properties.ref}
                        </span>
                      </span>
                      <span className="tabular-nums">
                        {metric === "perKm"
                          ? i18n.language === "bg"
                            ? "Цена/км: "
                            : "Cost/km: "
                          : i18n.language === "bg"
                            ? "Една оферта: "
                            : "Single bid: "}
                        {fmtVal(f.properties.corridor)}
                      </span>
                      {byName.get(f.properties.corridor) ? (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {formatEur(
                            byName.get(f.properties.corridor)!.totalEur,
                          )}
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
            ))}
          </svg>
        ) : (
          <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
            {i18n.language === "bg" ? "Зареждане на картата…" : "Loading map…"}
          </div>
        )}
      </div>
      {/* Legend */}
      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>{i18n.language === "bg" ? "ниско" : "low"}</span>
        <span className="flex">
          {RAMP.map((c) => (
            <span key={c} className="h-2.5 w-6" style={{ background: c }} />
          ))}
        </span>
        <span>{i18n.language === "bg" ? "високо" : "high"}</span>
        <span className="ml-3 inline-flex items-center gap-1">
          <span className="h-2.5 w-6" style={{ background: NO_DATA }} />
          {i18n.language === "bg" ? "няма данни" : "no data"}
        </span>
        <span className="ml-auto">
          {geo?.attribution ?? "© OpenStreetMap (ODbL)"}
        </span>
      </div>
      {tooltip}
    </>
  );
};
