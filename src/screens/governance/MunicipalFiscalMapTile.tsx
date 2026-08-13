// The per-município choropleth above the /governance/municipal-finance table:
// map for the pattern, table for the detail, both driven by the same `?year`.
//
// Built on the same primitives as `FundsMuniMapTile` — FeatureMap + LeafletMap
// + SVGMapContainer + useSofiaMergedNationMap + MapLayout — including the Sofia
// district → SOF00 fallback and the resolveRow / value split.
//
// The layers and their palettes live in `municipalFiscalLayers`, where the
// reasoning is written down and testable. Two rules are enforced HERE because
// they are about rendering:
//
//   - **A município that did not file is `absent`, not zero.** It gets a
//     distinct no-data fill and the legend names it with a count. Colouring it
//     as 0 would paint a non-filer the healthiest shade in the country — the
//     single worst thing this map could do.
//   - **Sofia's 24 districts all take Столична община's one row**, which is the
//     existing SOF00 convention and is right, but the tooltip must SAY so or a
//     reader concludes the districts were measured separately.
//
// ONE YEAR AT A TIME, chosen with the browse's year picker. The backfill gave
// the corpus nine year-ends, so a reader can now step through them — but the
// map still draws one, and it cannot yet AVERAGE them. Separating a sustained
// commitment level from a single project spike needs a 3-year-mean layer,
// which is the remaining gap and is what the caption says.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MapIcon } from "lucide-react";
import type { GeoPermissibleObjects } from "d3-geo";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useTooltip } from "@/ux/useTooltip";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useSofiaMergedNationMap } from "@/data/municipalities/useSofiaMergedNationMap";
import { useNavigateParams } from "@/ux/useNavigateParams";
import { isSofiaRayonObshtina } from "@/data/dataTypes";
import { LeafletMap } from "@/screens/components/maps/LeafletMap";
import { SVGMapContainer } from "@/screens/components/maps/SVGMapContainer";
import { FeatureMap } from "@/screens/components/maps/FeatureMap";
import { getDataProjection } from "@/screens/components/maps/d3_utils";
import { MapLayout, type MapCoordinates } from "@/layout/dataview/MapLayout";
import type { MunicipalFiscalRankingRow } from "@/data/budget/useMunicipalFiscalRanking";
import {
  LAYERS,
  cohortStats,
  fillFor,
  intensity,
  layerById,
  type LayerId,
} from "./municipalFiscalLayers";

const SOFIA_SYNTH = "SOF00";

/** Resolve a feature's code to a row.
 *
 *  The район fallback is kept because `useSofiaMergedNationMap` is the ONLY
 *  reason it is unnecessary — that hook merges Sofia's 24 районни features into
 *  one `SOF00` polygon before this component sees them (288 features in, 265
 *  out, 1:1 with the corpus), so `isSofiaRayonObshtina` never fires here. A
 *  future switch to the unmerged geometry would need it, and it costs nothing.
 *
 *  What the fallback must NOT do is carry the Sofia disclosure: keyed on it,
 *  the „these are city-wide figures" line could never render, which is the
 *  opposite of the requirement. The disclosure is keyed on the CODE instead —
 *  see `isCityWide` below — so it shows on Sofia's polygon under either
 *  geometry. */
const resolveRow = (
  byMuni: Map<string, MunicipalFiscalRankingRow>,
  code: string,
): MunicipalFiscalRankingRow | null =>
  byMuni.get(code) ??
  (isSofiaRayonObshtina(code) ? (byMuni.get(SOFIA_SYNTH) ?? null) : null);

/** Sofia's one row stands for the whole município. True on the merged polygon
 *  AND on any район feature, so the disclosure survives either geometry. */
const isCityWide = (code: string): boolean =>
  code === SOFIA_SYNTH || isSofiaRayonObshtina(code);

const Inner: FC<{
  rows: MunicipalFiscalRankingRow[];
  layerId: LayerId;
  size: MapCoordinates;
}> = ({ rows, layerId, size }) => {
  const { t, i18n } = useTranslation();
  const { tooltip, ...tooltipEvents } = useTooltip();
  const mapGeo = useSofiaMergedNationMap();
  const { findMunicipality } = useMunicipalities();
  const navigate = useNavigateParams();
  const lang = i18n.language;
  const layer = layerById(layerId);

  const byMuni = useMemo(() => {
    const m = new Map<string, MunicipalFiscalRankingRow>();
    for (const r of rows) m.set(r.obshtina, r);
    return m;
  }, [rows]);

  // The cohort is computed over the ROWS, not over the map features — Sofia's
  // 24 districts share one row, and counting it 24 times would drag the
  // diverging layer's centre toward the capital.
  const cohort = useMemo(
    () =>
      cohortStats(
        rows
          .map((r) => layer.value(r))
          .filter((v): v is number => v != null && Number.isFinite(v)),
      ),
    [rows, layer],
  );

  const { proj, cells, noDataCount } = useMemo(() => {
    const empty = {
      proj: undefined as ReturnType<typeof getDataProjection> | undefined,
      cells: new Map<
        string,
        {
          row: MunicipalFiscalRankingRow;
          value: number | null;
          i: number | null;
        }
      >(),
      noDataCount: 0,
    };
    if (!mapGeo) return empty;
    const proj = getDataProjection(mapGeo as GeoPermissibleObjects, size);
    const out = empty.cells;
    let missing = 0;
    for (const feature of mapGeo.features) {
      const code = feature.properties.nuts4;
      const row = resolveRow(byMuni, code);
      if (!row) {
        missing++;
        continue;
      }
      const value = layer.value(row);
      if (value == null) missing++;
      out.set(code, { row, value, i: intensity(layer, value, cohort) });
    }
    // Returned whole, not just its `path`: reading `bounds`/`scale` off a
    // SECOND call put a fit over all 265 nation polygons outside every memo, so
    // it re-ran on each layer toggle, each tooltip and each resize.
    return { proj, cells: out, noDataCount: missing };
  }, [mapGeo, byMuni, layer, cohort, size]);

  if (!mapGeo || !proj) return null;

  const s = layer.scale;
  // The legend follows the LAYER'S OWN scale rather than a fixed signed ramp.
  // A constant [-1..1] gradient described a scale three of the six layers never
  // draw: `quantile` only ever produces [0, 1], so half the bar was a colour
  // the map could not contain and the least-committed município in the country
  // was rendered amber; `binary` produces only ±1, so a continuous ramp implied
  // gradations that do not exist.
  const stops: number[] = s.kind === "binary" ? [-1, 1] : [-1, -0.5, 0, 0.5, 1];

  // Endpoint labels, in the layer's own units. The threshold layers saturate at
  // TWICE the line, which is a fact nothing on the page stated before.
  const ends: [string, string] | null =
    s.kind === "threshold"
      ? [layer.format(0, lang), `≥${layer.format(s.at * 2, lang)}`]
      : s.kind === "ordinal"
        ? ["0", `${s.max}`]
        : s.kind === "quantile"
          ? [layer.format(0, lang), layer.format(cohort.max, lang)]
          : null;

  // The middle label, and WHAT KIND of line it is. „праг" belongs to a
  // statutory number (50, 5, 3); the collection layer's centre is an
  // unweighted mean of 265 municipal rates that we computed — and чл. 130а
  // т. 6's actual test is against the tax-base-weighted NATIONAL rate, which
  // this repo elsewhere declares unavailable. Calling it a threshold would lend
  // the statute's authority to our own proxy. It is also the one layer whose
  // break moves between years, which the label now says.
  const midLabel =
    s.kind === "threshold"
      ? t("mf_map_legend_break", { value: layer.format(s.at, lang) })
      : s.kind === "ordinal"
        ? t("mf_map_legend_break", { value: `${s.at}` })
        : s.kind === "diverging"
          ? t("mf_map_legend_cohort_mean", {
              value: layer.format(cohort.mean, lang),
            })
          : null;

  const legend = (
    <div className="absolute bottom-3 left-3 z-[1000] rounded-md bg-background/90 backdrop-blur-sm border border-border shadow-sm px-3 py-2 w-[250px] pointer-events-none">
      <div className="text-[11px] font-medium text-foreground mb-1 truncate">
        {t(layer.legendKey)}
      </div>
      {s.kind === "binary" ? (
        // Two swatches, not a ramp: this layer has exactly two states.
        <div className="flex gap-3 text-[10px] text-muted-foreground">
          {[
            { v: 1, key: "mf_map_legend_recovery_yes" },
            { v: -1, key: "mf_map_legend_recovery_no" },
          ].map(({ v, key }) => (
            <span key={key} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-3 rounded-sm border border-border/50"
                style={{ backgroundColor: fillFor(v) }}
              />
              {t(key)}
            </span>
          ))}
        </div>
      ) : (
        <>
          <div
            className="h-2 w-full rounded-sm border border-border/50"
            style={{
              background: `linear-gradient(to right, ${stops
                .map(
                  (v, k) => `${fillFor(v)} ${(k / (stops.length - 1)) * 100}%`,
                )
                .join(", ")})`,
            }}
            role="img"
            aria-label={t(layer.legendKey)}
          />
          {ends && (
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1 tabular-nums">
              <span>{ends[0]}</span>
              <span>{ends[1]}</span>
            </div>
          )}
        </>
      )}
      {midLabel && (
        <div className="text-[10px] text-muted-foreground mt-1 tabular-nums text-center">
          {midLabel}
        </div>
      )}
      {/* The no-data class is NAMED and COUNTED. Left off the legend it reads
          as the palette's lightest value, i.e. as „nothing owed". */}
      {noDataCount > 0 && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-1">
          <span
            className="inline-block h-2 w-3 rounded-sm border border-border/50"
            style={{ backgroundColor: fillFor(null) }}
          />
          {t("mf_map_legend_no_data", { count: noDataCount })}
        </div>
      )}
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
            const cell = cells.get(code);
            return (
              <FeatureMap
                key={`mf-map-${idx}`}
                geoPath={proj.path}
                fillColor={fillFor(cell?.i ?? null)}
                feature={feature}
                onClick={() =>
                  navigate({
                    pathname: `/governance/${cell?.row.obshtina ?? code}`,
                  })
                }
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
                    <div className="text-left">
                      <div className="text-base font-semibold pb-1">
                        {displayName}
                      </div>
                      <div className="text-sm">
                        <span className="text-muted-foreground">
                          {t(layer.labelKey)}:
                        </span>{" "}
                        <span className="font-semibold tabular-nums">
                          {/* The layer's own `format` is a palette helper, not
                              display copy: on the binary layer it produces „1",
                              and on the criteria layer a bare count — while the
                              table two hundred pixels below says „да" and
                              „N от 6". Same page, same field, one vocabulary. */}
                          {cell?.value == null
                            ? "—"
                            : s.kind === "binary"
                              ? t(
                                  cell.value
                                    ? "mf_recovery_yes"
                                    : "mf_map_legend_recovery_no",
                                )
                              : s.kind === "ordinal"
                                ? t("mf_criteria_of_six", { met: cell.value })
                                : layer.format(cell.value, lang)}
                        </span>
                      </div>
                      {cell && cell.value == null && (
                        <div className="text-xs italic text-muted-foreground mt-1">
                          {t("mf_map_tooltip_no_value")}
                        </div>
                      )}
                      {!cell && (
                        <div className="text-xs italic text-muted-foreground mt-1">
                          {t("mf_map_tooltip_no_row")}
                        </div>
                      )}
                      {isCityWide(code) && (
                        // Without this a reader concludes the 24 districts were
                        // measured separately. They were not — МФ publishes one
                        // return for Столична община.
                        <div className="text-xs text-muted-foreground mt-1">
                          {t("mf_map_tooltip_sofia")}
                        </div>
                      )}
                    </div>,
                  );
                }}
                onMouseMove={(e) =>
                  tooltipEvents.onMouseMove({ pageX: e.pageX, pageY: e.pageY })
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

export const MunicipalFiscalMapTile: FC<{
  rows: MunicipalFiscalRankingRow[];
  layerId: LayerId;
  onLayerChange: (id: LayerId) => void;
  year?: number;
}> = ({ rows, layerId, onLayerChange, year }) => {
  const { t } = useTranslation();
  const layer = layerById(layerId);
  if (rows.length === 0) return null;

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <MapIcon className="h-4 w-4 text-indigo-600" aria-hidden />
          <span>{t("mf_map_title")}</span>
          {year != null && (
            <span className="text-xs font-normal text-muted-foreground">
              {t("mf_map_year", { year })}
            </span>
          )}
          <div className="ml-auto flex flex-wrap gap-1 rounded-md border border-border bg-background p-0.5">
            {LAYERS.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => onLayerChange(l.id)}
                aria-pressed={layerId === l.id}
                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                  layerId === l.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {t(l.labelKey)}
              </button>
            ))}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-2 md:p-3">
        <MapLayout>
          {(size) => <Inner rows={rows} layerId={layerId} size={size} />}
        </MapLayout>
        {layer.caveatKey && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            {t(layer.caveatKey)}
          </p>
        )}
        {/* The map shows ONE year-end at a time. That was a hard limit while
            the corpus held a single year; since the backfill it is a choice the
            reader makes with the picker above, so the line says which year is
            drawn and that the others are reachable — not that the data does not
            exist. A 3-year-mean layer is the remaining gap. */}
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t("mf_map_one_year_at_a_time")}
        </p>
      </CardContent>
    </Card>
  );
};
