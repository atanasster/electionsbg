// Choropleth of farm-subsidy money by oblast for the /subsidies dashboard.
// Mirrors ProcurementOblastMap: the Sofia-merged region GeoJSON + the d3
// projection helper + the FeatureMap path primitive + the shared useTooltip.
//
// The subsidy data is keyed by oblast NAME (as ДФЗ publishes it); regions.json
// gives name → oblast code, and the map features are keyed by that code (with
// Plovdiv's grad/oblast split PDV/PDV-00 both folding to PDV, and Sofia city's
// three МИР already merged to one SOF polygon by useSofiaMergedRegionsMap).
// Clicking an oblast deep-links to its beneficiaries in the browse.

import { FC, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSofiaMergedRegionsMap } from "@/data/regions/useSofiaMergedRegionsMap";
import { getDataProjection } from "@/screens/components/maps/d3_utils";
import { FeatureMap } from "@/screens/components/maps/FeatureMap";
import { useTooltip } from "@/ux/useTooltip";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { formatEur } from "@/lib/currency";
import type { AgriOblastSlice } from "@/data/agri/types";
import regions from "@/data/json/regions.json";

// Emerald sequential ramp (light → dark), matching the pack's identity.
const RAMP = [
  "#d1fae5",
  "#a7f3d0",
  "#6ee7b7",
  "#34d399",
  "#10b981",
  "#059669",
  "#047857",
];
const NO_DATA = "hsl(var(--muted))";

// oblast display name → NSI oblast code, from the committed regions list.
const NAME_TO_CODE = new Map<string, string>(
  (regions as Array<{ name: string; oblast: string }>).map((r) => [
    r.name,
    r.oblast,
  ]),
);

// ДФЗ oblast name → the map's oblast code. Sofia city/province carry different
// punctuation than regions.json, so pin them explicitly.
const codeForName = (name: string): string | undefined => {
  if (name === "София (столица)") return "SOF";
  if (name === "София (област)") return "SFO";
  return NAME_TO_CODE.get(name);
};

// Fold a feature code back to the value key (Plovdiv's two features share PDV).
const featCode = (nuts3: string): string =>
  nuts3 === "PDV-00" ? "PDV" : nuts3;

export const AgriOblastMap: FC<{
  rows: AgriOblastSlice[];
  locale: string;
  bg: boolean;
  /** Fired with the oblast display name of a clicked region. */
  onSelectOblast?: (name: string) => void;
}> = ({ rows, locale, bg, onSelectOblast }) => {
  const mapGeo = useSofiaMergedRegionsMap();
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

  const byCode = useMemo(() => {
    const m = new Map<string, AgriOblastSlice>();
    for (const o of rows) {
      const code = codeForName(o.oblast);
      // Fold through featCode so the data key matches the feature key — ДФЗ's
      // "Пловдив" resolves to PDV-00 in regions.json, but the map's Plovdiv
      // feature(s) canonicalise to PDV.
      if (code) m.set(featCode(code), o);
    }
    return m;
  }, [rows]);

  // Percentile thresholds from the per-oblast totals, so one dominant oblast
  // doesn't wash the ramp out.
  const sorted = useMemo(
    () => [...byCode.values()].map((o) => o.totalEur).sort((a, b) => a - b),
    [byCode],
  );

  const colorFor = (v: number | undefined): string => {
    if (v == null || sorted.length === 0) return NO_DATA;
    const rank = sorted.filter((x) => x <= v).length / sorted.length;
    return RAMP[Math.min(RAMP.length - 1, Math.floor(rank * RAMP.length))];
  };

  // {tooltip} must be a sibling of the (relative) map div — useTooltip positions
  // with page coordinates, so its offset parent has to be the document.
  return (
    <>
      <div ref={ref} className="relative w-full h-[280px] md:h-[320px]">
        {projection && mapGeo ? (
          <svg
            width={size?.[0]}
            height={size?.[1]}
            viewBox={`0 0 ${size?.[0]} ${size?.[1]}`}
            className="overflow-visible"
            role="img"
            aria-label={bg ? "Субсидии по област" : "Subsidies by region"}
          >
            {mapGeo.features.map((feature, idx) => {
              const code = featCode(feature.properties.nuts3);
              const o = byCode.get(code);
              return (
                <FeatureMap
                  key={`${feature.properties.nuts3}-${idx}`}
                  feature={feature}
                  geoPath={projection.path}
                  fillColor={colorFor(o?.totalEur)}
                  onCursor={() => (o && onSelectOblast ? "pointer" : "default")}
                  ariaLabel={
                    o
                      ? `${o.oblast}: ${formatEur(o.totalEur, locale)}`
                      : undefined
                  }
                  onClick={() => {
                    if (o && onSelectOblast) onSelectOblast(o.oblast);
                  }}
                  onMouseEnter={(e) =>
                    onMouseEnter(
                      { pageX: e.pageX, pageY: e.pageY },
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium">{o?.oblast ?? code}</span>
                        {o ? (
                          <>
                            <span className="tabular-nums">
                              {formatEur(o.totalEur, locale)}
                            </span>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {o.share}%{" "}
                              {bg ? "от общата сума" : "of the total"}
                            </span>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {bg ? "няма данни" : "no data"}
                          </span>
                        )}
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
      {tooltip}
    </>
  );
};
