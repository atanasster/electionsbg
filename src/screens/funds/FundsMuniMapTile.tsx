// Per-муни choropleth map of EU-funds activity for /funds. Three metric
// modes — absolute total, per-capita €, and disbursement rate — toggleable
// via the header. Built on the same FeatureMap + LeafletMap + SVGMapContainer
// primitives the IndicatorsChoroplethMap on /demographics uses, with Sofia
// district features falling back to the synthetic SOF00 aggregate (matches
// the existing convention).

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { MapIcon } from "lucide-react";
import * as d3 from "d3";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useNavigateParams } from "@/ux/useNavigateParams";
import { useTooltip } from "@/ux/useTooltip";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useSofiaMergedNationMap } from "@/data/municipalities/useSofiaMergedNationMap";
import { useFundsMuniMap } from "@/data/funds/useFundsMuniMap";
import { LeafletMap } from "../components/maps/LeafletMap";
import { SVGMapContainer } from "../components/maps/SVGMapContainer";
import { FeatureMap } from "../components/maps/FeatureMap";
import { getDataProjection } from "../components/maps/d3_utils";
import { MapLayout, type MapCoordinates } from "@/layout/dataview/MapLayout";
import { sequentialColor } from "../components/demographics/censusMetrics";
import type {
  FundsProjectsMuniMapFile,
  FundsProjectsMuniMapRow,
} from "@/data/funds/types";

const SOFIA_SYNTH = "SOF00";
const isSofiaDistrict = (code: string): boolean => /^S2[3-5]\d{2}$/i.test(code);

type Metric = "total" | "perCapita" | "disbursement";

const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return `€${v.toLocaleString("en-US")}`;
};

const numFmt = new Intl.NumberFormat("bg-BG");

// Resolve a feature's муни code to a map-data row, handling the Sofia
// district → SOF00 fallback.
const resolveRow = (
  byMuni: Map<string, FundsProjectsMuniMapRow>,
  code: string,
): { row: FundsProjectsMuniMapRow; sofiaFallback: boolean } | null => {
  const direct = byMuni.get(code);
  if (direct) return { row: direct, sofiaFallback: false };
  if (isSofiaDistrict(code)) {
    const sof = byMuni.get(SOFIA_SYNTH);
    if (sof) return { row: sof, sofiaFallback: true };
  }
  return null;
};

// Extract the metric value for a given row + metric. Returns null when the
// row can't supply that metric (Sofia perCapita, or a row with no totalEur).
const metricValue = (
  row: FundsProjectsMuniMapRow,
  metric: Metric,
): number | null => {
  if (metric === "total") return row.totalEur > 0 ? row.totalEur : null;
  if (metric === "perCapita") return row.perCapitaEur;
  // disbursement
  if (row.totalEur <= 0) return null;
  return (row.paidEur / row.totalEur) * 100;
};

// Format a metric value for tooltip / legend.
const formatMetric = (v: number | null, metric: Metric): string => {
  if (v == null) return "—";
  if (metric === "disbursement") return `${v.toFixed(0)}%`;
  return compactEur(v);
};

const FundsMuniMapInner: FC<{
  data: FundsProjectsMuniMapFile;
  metric: Metric;
  size: MapCoordinates;
}> = ({ data, metric, size }) => {
  const { t, i18n } = useTranslation();
  const { tooltip, ...tooltipEvents } = useTooltip();
  // Sofia drawn as one Столична-община polygon (keyed nuts4 "SOF00") instead of
  // its 24 районни shards, since EU-funds are aggregated to the whole city. The
  // SOF00 row is resolved directly by resolveRow.
  const mapGeo = useSofiaMergedNationMap();
  const { findMunicipality } = useMunicipalities();
  const navigate = useNavigateParams();
  const lang = i18n.language;

  const byMuni = useMemo(() => {
    const m = new Map<string, FundsProjectsMuniMapRow>();
    for (const row of data.munis) m.set(row.muni, row);
    return m;
  }, [data]);

  // Absolute and per-capita € have very heavy tails — a tiny муни landing a
  // single €10 M project can sit 100× the median per-capita. A linear ramp
  // would collapse the bulk of the country into the bottom of the colour
  // scale and leave one extreme outlier saturated. We log-transform those
  // two metrics so the structure across the body of the data stays visible.
  // Disbursement rate is naturally bounded [0, 100 %], so it stays linear.
  const useLog = metric === "total" || metric === "perCapita";
  const xform = (v: number): number =>
    useLog ? Math.log10(Math.max(v, 1)) : v;
  const invXform = (v: number): number => (useLog ? Math.pow(10, v) : v);

  const { path, valuesByFeature, range } = useMemo(() => {
    const empty = {
      path: undefined as d3.GeoPath | undefined,
      valuesByFeature: new Map<
        string,
        {
          value: number;
          row: FundsProjectsMuniMapRow;
          sofiaFallback: boolean;
        }
      >(),
      range: undefined as [number, number] | undefined,
    };
    if (!mapGeo) return empty;
    const proj = getDataProjection(mapGeo as d3.GeoPermissibleObjects, size);
    const values = new Map<
      string,
      {
        value: number;
        row: FundsProjectsMuniMapRow;
        sofiaFallback: boolean;
      }
    >();
    let min = Infinity;
    let max = -Infinity;
    for (const feature of mapGeo.features) {
      const code = feature.properties.nuts4;
      const resolved = resolveRow(byMuni, code);
      if (!resolved) continue;
      const v = metricValue(resolved.row, metric);
      if (v == null) continue;
      values.set(code, {
        value: v,
        row: resolved.row,
        sofiaFallback: resolved.sofiaFallback,
      });
      const tv = xform(v);
      if (tv < min) min = tv;
      if (tv > max) max = tv;
    }
    return {
      path: proj.path,
      valuesByFeature: values,
      range:
        Number.isFinite(min) && Number.isFinite(max) && max > min
          ? ([min, max] as [number, number])
          : undefined,
    };
    // xform is derived from `metric`, so listing metric alone covers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapGeo, byMuni, metric, size]);

  if (!mapGeo || !path) return null;

  const proj = getDataProjection(mapGeo as d3.GeoPermissibleObjects, size);

  // For disbursement rate, "higher is better" (paid out more of what was
  // contracted) — match the indicator convention by inverting the colour
  // ramp so the dark end shows distressed (low-disbursement) places.
  // Absolute and per-capita treat higher as more intense (no inversion).
  const inverted = metric === "disbursement";
  const colorAt = (t: number): string => sequentialColor(inverted ? 1 - t : t);

  const legendStops = [0, 0.25, 0.5, 0.75, 1];
  // Legend ticks: interpolate in the transformed (log) space, then invert
  // back so the labels show real €/per-capita values rather than log digits.
  const legendValueAt = (t: number): number | undefined => {
    if (!range) return undefined;
    return invXform(range[0] + (range[1] - range[0]) * t);
  };

  const legendLabel =
    metric === "total"
      ? t("funds_map_legend_total")
      : metric === "perCapita"
        ? t("funds_map_legend_per_capita")
        : t("funds_map_legend_disbursement");

  const legend = range && (
    <div className="absolute bottom-3 left-3 z-[1000] rounded-md bg-background/90 backdrop-blur-sm border border-border shadow-sm px-3 py-2 w-[240px] pointer-events-none">
      <div className="text-[11px] font-medium text-foreground mb-1 truncate">
        {legendLabel}
      </div>
      <div
        className="h-2 w-full rounded-sm border border-border/50"
        style={{
          background: `linear-gradient(to right, ${legendStops
            .map((s) => `${colorAt(s)} ${(s * 100).toFixed(0)}%`)
            .join(", ")})`,
        }}
        role="img"
        aria-label={`${legendLabel} scale`}
      />
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1 tabular-nums">
        <span>{formatMetric(legendValueAt(0) ?? null, metric)}</span>
        <span>{formatMetric(legendValueAt(0.5) ?? null, metric)}</span>
        <span>{formatMetric(legendValueAt(1) ?? null, metric)}</span>
      </div>
    </div>
  );

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
            const cell = valuesByFeature.get(code);
            const fill =
              cell !== undefined && range
                ? colorAt(
                    (xform(cell.value) - range[0]) / (range[1] - range[0]),
                  )
                : "hsl(0, 0%, 90%)";
            return (
              <FeatureMap
                key={`funds-map-${idx}`}
                geoPath={path}
                fillColor={fill}
                feature={feature}
                onClick={() => {
                  // The Sofia city bundle carries the synthetic code SOF00,
                  // which /settlement/:id can't resolve (its parliamentary
                  // view is the dedicated /sofia page — see placeViews
                  // parliamentaryUrl). Every other município resolves at
                  // /settlement/<obshtina>.
                  navigate({
                    pathname:
                      code === SOFIA_SYNTH ? "/sofia" : `/settlement/${code}`,
                  });
                }}
                onMouseEnter={(e) => {
                  const info = findMunicipality(code);
                  const displayName =
                    code === SOFIA_SYNTH
                      ? t("local_region_sofia_city")
                      : info
                        ? lang === "bg"
                          ? info.long_name || info.name
                          : info.long_name_en || info.name_en
                        : code;
                  tooltipEvents.onMouseEnter(
                    { pageX: e.pageX, pageY: e.pageY },
                    cell ? (
                      <div className="text-left">
                        <div className="text-base font-semibold pb-1">
                          {displayName}
                        </div>
                        <div className="text-sm space-y-0.5">
                          <div>
                            <span className="text-muted-foreground">
                              {t("funds_map_tooltip_contracted")}:
                            </span>{" "}
                            <span className="font-semibold tabular-nums">
                              {compactEur(cell.row.totalEur)}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              {t("funds_map_tooltip_paid")}:
                            </span>{" "}
                            <span className="tabular-nums">
                              {compactEur(cell.row.paidEur)}
                            </span>{" "}
                            <span className="text-muted-foreground">
                              (
                              {(
                                (cell.row.paidEur / cell.row.totalEur) *
                                100
                              ).toFixed(0)}
                              %)
                            </span>
                          </div>
                          {cell.row.perCapitaEur != null ? (
                            <div>
                              <span className="text-muted-foreground">
                                {t("funds_map_tooltip_per_capita")}:
                              </span>{" "}
                              <span className="tabular-nums">
                                {compactEur(cell.row.perCapitaEur)}
                              </span>
                            </div>
                          ) : null}
                          <div className="text-xs text-muted-foreground">
                            {numFmt.format(cell.row.contractCount)}{" "}
                            {t("funds_map_tooltip_contracts")}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-left">
                        <div className="text-base font-semibold">
                          {displayName}
                        </div>
                        <div className="text-xs italic text-muted-foreground mt-1">
                          {t("funds_map_tooltip_no_data")}
                        </div>
                      </div>
                    ),
                  );
                }}
                onMouseMove={(e) =>
                  tooltipEvents.onMouseMove({
                    pageX: e.pageX,
                    pageY: e.pageY,
                  })
                }
                onMouseLeave={tooltipEvents.onMouseLeave}
              />
            );
          })}
        </SVGMapContainer>
        {legend}
      </div>
      {tooltip}
    </div>
  );
};

const METRIC_LABELS: Array<{ metric: Metric; i18nKey: string }> = [
  { metric: "total", i18nKey: "funds_map_metric_total" },
  { metric: "perCapita", i18nKey: "funds_map_metric_per_capita" },
  { metric: "disbursement", i18nKey: "funds_map_metric_disbursement" },
];

export const FundsMuniMapTile: FC = () => {
  const { t } = useTranslation();
  const { data } = useFundsMuniMap();
  const [metric, setMetric] = useState<Metric>("perCapita");

  if (!data) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <MapIcon className="h-4 w-4 text-emerald-600" aria-hidden />
          <span>{t("funds_map_title")}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {t("funds_map_subtitle", { n: data.muniCount })}
          </span>
          <div className="ml-auto flex gap-1 rounded-md border border-border bg-background p-0.5">
            {METRIC_LABELS.map(({ metric: m, i18nKey }) => (
              <button
                key={m}
                type="button"
                onClick={() => setMetric(m)}
                aria-pressed={metric === m}
                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                  metric === m
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {t(i18nKey)}
              </button>
            ))}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-2 md:p-3">
        <MapLayout>
          {(size) => (
            <FundsMuniMapInner data={data} metric={metric} size={size} />
          )}
        </MapLayout>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {t("funds_map_caveat")}
        </p>
      </CardContent>
    </Card>
  );
};
