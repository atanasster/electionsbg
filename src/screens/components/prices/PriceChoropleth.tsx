// Municipality choropleth for the КЗП price basket. Three metrics:
//   • level  — basket cost (€), sequential colour
//   • change — change since the euro (%), sequential colour
//   • chain  — the CHEAPEST chain in each município, CATEGORICAL colour (a hue
//              per top chain, the rest "other")
// Mirrors IndicatorsChoroplethMap (LeafletMap base + SVG features + legend +
// tooltip). Values from ranking.json's muni rows (level/change) or chain-map
// (chain). NOT official CPI.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigateParams } from "@/ux/useNavigateParams";
import { useTooltip } from "@/ux/useTooltip";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useSofiaMergedNationMap } from "@/data/municipalities/useSofiaMergedNationMap";
import {
  usePriceRanking,
  useChainMap,
  fmtEur,
  fmtPct,
} from "@/data/prices/usePrices";
import { LeafletMap } from "../maps/LeafletMap";
import { SVGMapContainer } from "../maps/SVGMapContainer";
import { FeatureMap } from "../maps/FeatureMap";
import { getDataProjection } from "../maps/d3_utils";
import type { MapCoordinates } from "@/layout/dataview/MapLayout";
import { sequentialColor } from "../demographics/censusMetrics";

export type PriceMetric = "level" | "change" | "chain";

// price-data Sofia muni key (SOF46) vs the merged-map key (SOF00)
const mapCode = (rankingCode: string): string =>
  rankingCode === "SOF46" ? "SOF00" : rankingCode;

// Categorical palette for the cheapest-chain map — distinct, theme-stable hues.
const CHAIN_PALETTE = [
  "#2563eb", // blue
  "#dc2626", // red
  "#16a34a", // green
  "#d97706", // amber
  "#7c3aed", // violet
  "#0891b2", // cyan
  "#db2777", // pink
  "#65a30d", // lime
];
const OTHER_COLOR = "#94a3b8"; // slate-400 — chains outside the top set
const NO_DATA = "hsl(0, 0%, 90%)";

export const PriceChoropleth: React.FC<{
  metric: PriceMetric;
  size: MapCoordinates;
}> = ({ metric, size }) => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { tooltip, ...tooltipEvents } = useTooltip();
  const mapGeo = useSofiaMergedNationMap();
  const { findMunicipality } = useMunicipalities();
  const { data: ranking } = usePriceRanking();
  const { data: chainMap } = useChainMap();
  const navigate = useNavigateParams();

  // ── numeric metrics (level / change): value + range per município ──
  const numeric = useMemo(() => {
    if (metric === "chain") return null;
    const values = new Map<string, number>();
    let min = Infinity;
    let max = -Infinity;
    for (const p of ranking?.places ?? []) {
      if (p.tier !== "muni") continue;
      const v = metric === "level" ? p.basketLevel : p.indexSinceEuro;
      if (v == null || !Number.isFinite(v)) continue;
      values.set(mapCode(p.code), v);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return {
      values,
      range:
        Number.isFinite(min) && max > min
          ? ([min, max] as [number, number])
          : undefined,
    };
  }, [ranking, metric]);

  // ── categorical metric (chain): cheapest chain per município, coloured by a
  // hue per top chain (by number of wins), the rest "other" ──
  const chainView = useMemo(() => {
    if (metric !== "chain") return null;
    const byCode = new Map<
      string,
      { eik: string; chain: string; basket: number }
    >();
    const wins = new Map<string, { chain: string; n: number }>();
    for (const m of chainMap?.munis ?? []) {
      byCode.set(mapCode(m.code), {
        eik: m.eik,
        chain: m.chain,
        basket: m.basket,
      });
      const w = wins.get(m.eik) ?? { chain: m.chain, n: 0 };
      w.n += 1;
      wins.set(m.eik, w);
    }
    const top = [...wins.entries()]
      .sort((a, b) => b[1].n - a[1].n || (a[0] < b[0] ? -1 : 1))
      .slice(0, CHAIN_PALETTE.length);
    const colorByEik = new Map<string, string>();
    top.forEach(([eik], i) => colorByEik.set(eik, CHAIN_PALETTE[i]));
    return {
      byCode,
      colorByEik,
      legend: top.map(([eik, w], i) => ({
        eik,
        chain: w.chain,
        color: CHAIN_PALETTE[i],
      })),
      hasOther: wins.size > top.length,
    };
  }, [chainMap, metric]);

  if (!mapGeo) return null;
  if (metric === "chain" ? !chainView : !numeric?.range) return null;

  const proj = getDataProjection(mapGeo as d3.GeoPermissibleObjects, size);
  const range = numeric?.range;
  const colorAt = (t01: number) => sequentialColor(t01);
  const fmtVal = (v: number): string =>
    metric === "level" ? fmtEur(v, lang) : fmtPct(v / 100 - 1);

  const metricLabel =
    metric === "level"
      ? lang === "bg"
        ? "Цена на кошницата"
        : "Basket cost"
      : metric === "change"
        ? lang === "bg"
          ? "Промяна от еврото"
          : "Change since the euro"
        : lang === "bg"
          ? "Най-евтина верига"
          : "Cheapest chain";

  const fillFor = (code: string): string => {
    if (metric === "chain") {
      const c = chainView!.byCode.get(code);
      if (!c) return NO_DATA;
      return chainView!.colorByEik.get(c.eik) ?? OTHER_COLOR;
    }
    const v = numeric!.values.get(code);
    return v !== undefined && range
      ? colorAt((v - range[0]) / (range[1] - range[0]))
      : NO_DATA;
  };

  const stops = [0, 0.25, 0.5, 0.75, 1];
  const legend =
    metric === "chain" ? (
      <div className="absolute bottom-3 left-3 z-[1000] max-w-[220px] rounded-md bg-background/90 backdrop-blur-sm border border-border shadow-sm px-3 py-2 pointer-events-none">
        <div className="text-[11px] font-medium text-foreground mb-1 truncate">
          {metricLabel}
        </div>
        <ul className="space-y-0.5">
          {chainView!.legend.map((l) => (
            <li key={l.eik} className="flex items-center gap-1.5 text-[10px]">
              <span
                className="inline-block size-2.5 rounded-sm shrink-0"
                style={{ background: l.color }}
              />
              <span className="truncate text-muted-foreground">{l.chain}</span>
            </li>
          ))}
          {chainView!.hasOther ? (
            <li className="flex items-center gap-1.5 text-[10px]">
              <span
                className="inline-block size-2.5 rounded-sm shrink-0"
                style={{ background: OTHER_COLOR }}
              />
              <span className="text-muted-foreground">
                {lang === "bg" ? "Други" : "Other"}
              </span>
            </li>
          ) : null}
        </ul>
      </div>
    ) : (
      <div className="absolute bottom-3 left-3 z-[1000] rounded-md bg-background/90 backdrop-blur-sm border border-border shadow-sm px-3 py-2 w-[240px] pointer-events-none">
        <div className="text-[11px] font-medium text-foreground mb-1 truncate">
          {metricLabel}
        </div>
        <div
          className="h-2 w-full rounded-sm border border-border/50"
          style={{
            background: `linear-gradient(to right, ${stops
              .map((s) => `${colorAt(s)} ${(s * 100).toFixed(0)}%`)
              .join(", ")})`,
          }}
          role="img"
          aria-label={`${metricLabel} scale`}
        />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1 tabular-nums">
          <span>{fmtVal(range![0])}</span>
          <span>{fmtVal(range![1])}</span>
        </div>
      </div>
    );

  const nameOf = (code: string): string =>
    code === "SOF00"
      ? lang === "bg"
        ? "София"
        : "Sofia"
      : (() => {
          const info = findMunicipality(code);
          return info ? (lang === "bg" ? info.name : info.name_en) : code;
        })();

  const tooltipBody = (code: string) => {
    const name = nameOf(code);
    if (metric === "chain") {
      const c = chainView!.byCode.get(code);
      return (
        <div className="text-left">
          <div className="text-base font-semibold pb-1">{name}</div>
          <div className="text-sm">
            {c ? (
              <>
                <span className="font-semibold">{c.chain}</span>
                {" · "}
                <span className="tabular-nums">{fmtEur(c.basket, lang)}</span>
              </>
            ) : lang === "bg" ? (
              "няма данни"
            ) : (
              "no data"
            )}
          </div>
        </div>
      );
    }
    const v = numeric!.values.get(code);
    return (
      <div className="text-left">
        <div className="text-base font-semibold pb-1">{name}</div>
        <div className="text-sm">
          {metricLabel}:{" "}
          <span className="font-semibold">
            {v !== undefined
              ? fmtVal(v)
              : lang === "bg"
                ? "няма данни"
                : "no data"}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="flex w-full">
      <div
        className="relative isolate"
        style={{ width: `${size[0]}px`, height: `${size[1]}px` }}
      >
        <LeafletMap size={size} bounds={proj.bounds} scale={proj.scale} />
        <SVGMapContainer
          size={size}
          supportsShiftArrows={false}
          supportsNames={false}
        >
          {mapGeo.features.map((feature, idx) => {
            const code = feature.properties.nuts4;
            return (
              <FeatureMap
                key={`prices-${idx}`}
                geoPath={proj.path}
                fillColor={fillFor(code)}
                feature={feature}
                onClick={() => navigate({ pathname: `/governance/${code}` })}
                onMouseEnter={(e) =>
                  tooltipEvents.onMouseEnter(
                    { pageX: e.pageX, pageY: e.pageY },
                    tooltipBody(code),
                  )
                }
                onMouseMove={(e) =>
                  tooltipEvents.onMouseMove({ pageX: e.pageX, pageY: e.pageY })
                }
                onMouseLeave={tooltipEvents.onMouseLeave}
              />
            );
          })}
        </SVGMapContainer>
        {legend}
        <span className="sr-only">{t("prices_not_cpi")}</span>
      </div>
      {tooltip}
    </div>
  );
};
