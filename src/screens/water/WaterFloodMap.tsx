// Choropleth hero for the /water flood-maintenance tile: riverbed-cleaning /
// river-regulation spend per oblast, drawn over the same oblast basemap + d3
// projection the АПИ roads map uses, with a decorative major-river "spine" on
// top so the country reads as water. The riverbed money is fragmented across
// ~100 small local watercourses, so the DATA layer is the per-oblast choropleth
// (awarder seat → oblast, 99.6% of €); the rivers are context only, not spend.
// See docs/plans/water-view-v1.md §4.5b.

import { FC, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSofiaMergedRegionsMap } from "@/data/regions/useSofiaMergedRegionsMap";
import { useRegions } from "@/data/regions/useRegions";
import { nuts3Name } from "@/data/procurement/bgNuts3";
import { useRiverGeometry } from "@/data/water/useRiverGeometry";
import type { FloodOblast } from "@/data/water/useFloodMaintenance";
import { getDataProjection } from "@/screens/components/maps/d3_utils";
import { useTooltip } from "@/ux/useTooltip";
import type { MapCoordinates } from "@/layout/dataview/MapLayout";
import { formatEur } from "@/lib/currency";

// Low → high ramp (teal → amber → red): more € spent = warmer.
const RAMP = ["#0F6E56", "#1D9E75", "#EF9F27", "#D85A30", "#A32D2D"];
const NO_DATA = "#B4B2A9";
const RIVER = "#2E7FB8";

// The merged basemap keys Sofia city as "SOF"; some Plovdiv shards carry a
// "-00" suffix — normalise both to the choropleth key.
const normCode = (nuts3: string): string =>
  nuts3 === "SOF" ? "SOF" : nuts3.replace(/-\d+$/, "");

export const WaterFloodMap: FC<{ byOblast: FloodOblast[] }> = ({
  byOblast,
}) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const mapGeo = useSofiaMergedRegionsMap();
  const { data: rivers } = useRiverGeometry();
  const { findRegion } = useRegions();
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
    const m = new Map<string, FloodOblast>();
    for (const o of byOblast) m.set(o.code, o);
    return m;
  }, [byOblast]);

  // Log scale — spend spans €0.3M → €120M+ (Sofia dominates), so a linear ramp
  // would wash out every other oblast.
  const logRange = useMemo(() => {
    const vals = byOblast.map((o) => o.eur).filter((v) => v > 0);
    if (!vals.length) return null;
    return [Math.log(Math.min(...vals)), Math.log(Math.max(...vals))] as const;
  }, [byOblast]);

  const colorFor = (code: string): string => {
    const o = byCode.get(code);
    if (!o || o.eur <= 0 || !logRange) return NO_DATA;
    const [lo, hi] = logRange;
    const f = hi > lo ? (Math.log(o.eur) - lo) / (hi - lo) : 0.5;
    return RAMP[Math.min(RAMP.length - 1, Math.floor(f * RAMP.length))];
  };

  const nameFor = (code: string): string => {
    if (code === "SOF") return bg ? "София (столица)" : "Sofia (capital)";
    const reg = findRegion(code);
    return reg ? nuts3Name(reg.nuts3, i18n.language) : code;
  };

  return (
    <>
      <div ref={ref} className="relative w-full h-[300px] md:h-[360px]">
        {projection && mapGeo ? (
          <svg
            width={size?.[0]}
            height={size?.[1]}
            viewBox={`0 0 ${size?.[0]} ${size?.[1]}`}
            className="overflow-visible"
            role="img"
            aria-label={
              bg
                ? "Разходи за почистване на речни корита по области"
                : "Riverbed-maintenance spend by oblast"
            }
          >
            {/* Choropleth — oblasts filled by € spent on riverbed maintenance. */}
            {mapGeo.features.map((feature, idx) => {
              const code = normCode(feature.properties.nuts3);
              const o = byCode.get(code);
              return (
                <path
                  key={`ob-${idx}`}
                  d={
                    projection.path(
                      feature as Parameters<typeof projection.path>[0],
                    ) ?? undefined
                  }
                  fill={colorFor(code)}
                  fillOpacity={0.9}
                  stroke="hsl(var(--background))"
                  strokeWidth={0.7}
                  style={{ cursor: o ? "default" : undefined }}
                  onMouseEnter={(e) =>
                    onMouseEnter(
                      { pageX: e.pageX, pageY: e.pageY },
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium">{nameFor(code)}</span>
                        <span className="tabular-nums">
                          {o ? formatEur(o.eur) : bg ? "няма данни" : "no data"}
                        </span>
                        {o ? (
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {o.count} {bg ? "договора" : "contracts"}
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
            {/* River spine — decorative context, drawn on top, non-interactive. */}
            {rivers?.features.map((f, idx) => (
              <path
                key={`rv-${idx}`}
                d={
                  projection.path(f as Parameters<typeof projection.path>[0]) ??
                  undefined
                }
                fill="none"
                stroke={RIVER}
                strokeWidth={f.properties.name === "Дунав" ? 1.6 : 0.9}
                strokeOpacity={0.55}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="pointer-events-none"
              />
            ))}
          </svg>
        ) : (
          <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
            {bg ? "Зареждане на картата…" : "Loading map…"}
          </div>
        )}
      </div>
      {/* Legend */}
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>{bg ? "малко" : "less"}</span>
        <span className="flex">
          {RAMP.map((c) => (
            <span key={c} className="h-2.5 w-6" style={{ background: c }} />
          ))}
        </span>
        <span>{bg ? "много €" : "more €"}</span>
        <span className="ml-3 inline-flex items-center gap-1">
          <span className="h-2.5 w-6" style={{ background: NO_DATA }} />
          {bg ? "няма данни" : "no data"}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-0.5 w-6" style={{ background: RIVER }} />
          {bg ? "големи реки" : "major rivers"}
        </span>
        <span className="ml-auto">
          {rivers?.attribution ?? "© OpenStreetMap (ODbL)"}
        </span>
      </div>
      {tooltip}
    </>
  );
};
