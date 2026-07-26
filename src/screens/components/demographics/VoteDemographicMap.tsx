import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCensus, censusMetricValue } from "@/data/census/useCensus";
import { useVoteDemographics } from "@/data/census/useVoteDemographics";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useElectionContext } from "@/data/ElectionContext";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useSofiaMergedNationMap } from "@/data/municipalities/useSofiaMergedNationMap";
import { useNavigateParams } from "@/ux/useNavigateParams";
import { useTooltip } from "@/ux/useTooltip";
import { useSearchParam } from "@/screens/utils/useSearchParam";
import { formatThousands } from "@/data/utils";
import type { CensusMetric } from "@/data/census/censusTypes";
import type { MapCoordinates } from "@/layout/dataview/MapLayout";
import { LeafletMap } from "../maps/LeafletMap";
import { SVGMapContainer } from "../maps/SVGMapContainer";
import { FeatureMap } from "../maps/FeatureMap";
import { getDataProjection } from "../maps/d3_utils";
import { MetricSelector } from "./MetricSelector";
import { METRIC_BY_KEY } from "./censusMetrics";
import {
  PERCENT_METRICS,
  pearson,
  censusMetricCount,
} from "./voteDemographicCorrelation";
import {
  NEUTRAL_RGB,
  mix,
  opposingColor,
  parseColor,
  rgbStr,
  type Rgb,
} from "./demographicMapColors";

const NO_DATA = "hsl(0, 0%, 90%)";
const DEFAULT_METRIC: CensusMetric = "eduSecondary";

type MuniStat = {
  x: number; // demographic %
  y: number; // party vote share %
  c: number; // local contribution to Pearson r (z_x · z_y)
  partyVotes: number;
  total: number;
  population: number;
  groupCount?: number;
  nameBg: string;
  nameEn: string;
};

// Vote↔demographic municipality choropleth. Replaces the old scatter: instead of
// one dot per município it paints each município by how much it drives the
// selected party's correlation with the selected demographic — concordant
// (firm party color), neutral (grey), or reversed (opposing complementary).
export const VoteDemographicMap: React.FC = () => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const { tooltip, ...tooltipEvents } = useTooltip();
  const { data: census } = useCensus();
  const { data: voteDemo } = useVoteDemographics();
  const { parties, findParty } = usePartyInfo();
  const { displayNameFor } = useCanonicalParties();
  const { selected } = useElectionContext();
  const mapGeo = useSofiaMergedNationMap();
  const { findMunicipality } = useMunicipalities();
  const navigate = useNavigateParams();

  // Same URL contract as the former scatter, so the dot-plot deep links keep
  // working: ?scatter=<metric>, ?scatterParty=<partyNum>.
  const [scatterMetricParam, setScatterMetricParam] = useSearchParam(
    "scatter",
    {
      replace: true,
    },
  );
  const [scatterPartyParam, setScatterPartyParam] = useSearchParam(
    "scatterParty",
    { replace: true },
  );
  const metric: CensusMetric =
    scatterMetricParam &&
    PERCENT_METRICS.includes(scatterMetricParam as CensusMetric)
      ? (scatterMetricParam as CensusMetric)
      : DEFAULT_METRIC;
  const setMetric = useCallback(
    (m: CensusMetric) =>
      setScatterMetricParam(m === DEFAULT_METRIC ? undefined : m),
    [setScatterMetricParam],
  );
  const partyNum: number | undefined = scatterPartyParam
    ? Number(scatterPartyParam)
    : undefined;
  const setPartyNum = useCallback(
    (n: number) => setScatterPartyParam(String(n)),
    [setScatterPartyParam],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scatterPartyParam && containerRef.current) {
      containerRef.current.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Measure via a callback ref rather than a mount-once effect: the map div is
  // only rendered after census/voteDemo resolve (see the `!census` guard below),
  // so a `useLayoutEffect(…, [])` would run before the div exists, bail on the
  // null ref, and never re-run — leaving `size` undefined and the map blank.
  // A callback ref instead fires whenever the node actually attaches.
  const [size, setSize] = useState<MapCoordinates | undefined>();
  const roRef = useRef<ResizeObserver | null>(null);
  const mapRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    if (!el) {
      roRef.current = null;
      return;
    }
    const measure = () =>
      setSize([el.offsetWidth, el.offsetHeight, el.offsetLeft, el.offsetTop]);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    roRef.current = ro;
  }, []);

  const partyLabel = (nickName: string) =>
    isBg ? nickName : (displayNameFor(nickName) ?? nickName);

  const eligibleParties = useMemo(
    () => (parties ? parties.slice().sort((a, b) => a.number - b.number) : []),
    [parties],
  );

  // Default to the top-vote party until one is chosen.
  const effectivePartyNum = useMemo(() => {
    if (partyNum !== undefined) return partyNum;
    if (!voteDemo) return undefined;
    const totals = new Map<number, number>();
    for (const muni of voteDemo.municipalities)
      for (const v of muni.votes)
        totals.set(v.partyNum, (totals.get(v.partyNum) ?? 0) + v.totalVotes);
    let best: number | undefined;
    let bestVal = -1;
    for (const [k, v] of totals)
      if (v > bestVal) {
        bestVal = v;
        best = k;
      }
    return best;
  }, [partyNum, voteDemo]);

  // Per-município demographic (x) and party vote share (y), then each município's
  // standardized co-deviation c = z_x · z_y — its signed contribution to the
  // overall Pearson r (r = mean(c)). `cap` (a robust high quantile of |c|) sets
  // the color-saturation ceiling so a single outlier doesn't wash out the map.
  const model = useMemo(() => {
    const byCode = new Map<string, MuniStat>();
    if (!census || !voteDemo || effectivePartyNum === undefined)
      return { byCode, r: 0, cap: 1 };
    const raw: {
      code: string;
      x: number;
      y: number;
      partyVotes: number;
      total: number;
      population: number;
      groupCount?: number;
      nameBg: string;
      nameEn: string;
    }[] = [];
    for (const muni of voteDemo.municipalities) {
      const entity = census.municipalities.find(
        (m) => m.code === muni.obshtina,
      );
      if (!entity) continue;
      const xRaw = censusMetricValue(entity, metric);
      if (xRaw === undefined) continue;
      let total = 0;
      let partyVotes = 0;
      for (const v of muni.votes) {
        total += v.totalVotes;
        if (v.partyNum === effectivePartyNum) partyVotes = v.totalVotes;
      }
      if (total <= 0) continue;
      raw.push({
        code: muni.obshtina,
        x: xRaw * 100,
        y: (partyVotes / total) * 100,
        partyVotes,
        total,
        population: entity.population,
        groupCount: censusMetricCount(entity, metric),
        nameBg: entity.nameBg,
        nameEn: entity.nameEn,
      });
    }
    const n = raw.length;
    if (n < 3) return { byCode, r: 0, cap: 1 };
    const meanX = raw.reduce((s, p) => s + p.x, 0) / n;
    const meanY = raw.reduce((s, p) => s + p.y, 0) / n;
    const sdX = Math.sqrt(raw.reduce((s, p) => s + (p.x - meanX) ** 2, 0) / n);
    const sdY = Math.sqrt(raw.reduce((s, p) => s + (p.y - meanY) ** 2, 0) / n);
    const cs: number[] = [];
    for (const p of raw) {
      const c =
        sdX > 0 && sdY > 0 ? ((p.x - meanX) / sdX) * ((p.y - meanY) / sdY) : 0;
      cs.push(Math.abs(c));
      byCode.set(p.code, { ...p, c });
    }
    // 90th percentile of |c| as the saturation cap, floored so faint maps still
    // read.
    const sorted = cs.slice().sort((a, b) => a - b);
    const cap = Math.max(
      0.6,
      sorted[Math.floor(0.9 * (sorted.length - 1))] ?? 1,
    );
    const r = pearson(
      raw.map((p) => p.x),
      raw.map((p) => p.y),
    );
    return { byCode, r, cap };
  }, [census, voteDemo, effectivePartyNum, metric]);

  const proj = useMemo(
    () =>
      mapGeo && size
        ? getDataProjection(mapGeo as d3.GeoPermissibleObjects, size)
        : undefined,
    [mapGeo, size],
  );

  const partyInfo =
    effectivePartyNum !== undefined ? findParty(effectivePartyNum) : undefined;
  const partyColorStr = partyInfo?.color ?? "hsl(213, 70%, 55%)";
  const partyRgb: Rgb = parseColor(partyColorStr) ?? [80, 120, 200];
  const opposingRgb = useMemo(
    () => opposingColor(partyColorStr),
    [partyColorStr],
  );
  const metricLabel = t(METRIC_BY_KEY[metric].i18nKey);

  const colorForCode = (code: string): string => {
    // Sofia is drawn as one merged polygon keyed SOF00; its data lives under the
    // census code SOF46.
    const dataCode = code === "SOF00" ? "SOF46" : code;
    const s = model.byCode.get(dataCode);
    if (!s) return NO_DATA;
    const tt = Math.min(1, Math.abs(s.c) / model.cap);
    if (tt < 0.02) return rgbStr(NEUTRAL_RGB);
    return rgbStr(mix(NEUTRAL_RGB, s.c >= 0 ? partyRgb : opposingRgb, tt));
  };

  const rColor =
    model.r > 0.4
      ? "hsl(140, 60%, 40%)"
      : model.r < -0.4
        ? "hsl(0, 70%, 50%)"
        : "hsl(0, 0%, 50%)";

  // Diverging legend: opposing → grey → party color.
  const legend = (
    <div className="absolute bottom-3 left-3 z-[1000] rounded-md bg-background/90 backdrop-blur-sm border border-border shadow-sm px-3 py-2 w-[240px] pointer-events-none">
      <div className="text-[11px] font-medium text-foreground mb-1 truncate">
        {partyInfo ? partyLabel(partyInfo.nickName) : ""} · {metricLabel}
      </div>
      <div
        className="h-2 w-full rounded-sm border border-border/50"
        style={{
          background: `linear-gradient(to right, ${rgbStr(opposingRgb)} 0%, ${rgbStr(
            NEUTRAL_RGB,
          )} 50%, ${rgbStr(partyRgb)} 100%)`,
        }}
        role="img"
        aria-label={t("census_map_scale")}
      />
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
        <span>{t("census_map_reversed")}</span>
        <span>{t("census_map_neutral")}</span>
        <span>{t("census_map_aligned")}</span>
      </div>
    </div>
  );

  if (!census || !PERCENT_METRICS.includes(metric)) return null;

  return (
    <div ref={containerRef} className="scroll-mt-24">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            {t("census_axis_party")}
          </label>
          <Select
            value={String(effectivePartyNum ?? "")}
            onValueChange={(v) => setPartyNum(Number(v))}
          >
            <SelectTrigger className="w-[260px]">
              <SelectValue>
                {partyInfo ? partyLabel(partyInfo.nickName) : ""}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {eligibleParties.map((p) => (
                <SelectItem key={p.number} value={String(p.number)}>
                  {partyLabel(p.nickName)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            {t("census_axis_demographic")}
          </label>
          <MetricSelector
            value={metric}
            onChange={setMetric}
            metrics={PERCENT_METRICS}
          />
        </div>
        <div className="ml-auto text-sm">
          <span className="text-muted-foreground mr-2">
            {t("census_correlation")}:
          </span>
          <span
            className="font-semibold tabular-nums"
            style={{ color: rColor }}
          >
            {model.r.toFixed(2)}
          </span>
        </div>
      </div>

      <div
        ref={mapRef}
        className="relative isolate h-[420px] w-full md:h-[520px]"
      >
        {mapGeo && proj && size && (
          <>
            <LeafletMap size={size} bounds={proj.bounds} scale={proj.scale} />
            <SVGMapContainer
              size={size}
              supportsShiftArrows={false}
              supportsNames={false}
            >
              {mapGeo.features.map((feature, idx) => {
                const code = feature.properties.nuts4;
                const dataCode = code === "SOF00" ? "SOF46" : code;
                const s = model.byCode.get(dataCode);
                return (
                  <FeatureMap
                    key={`vd-${idx}`}
                    geoPath={proj.path}
                    fillColor={colorForCode(code)}
                    feature={feature}
                    onClick={() =>
                      navigate({
                        pathname:
                          code === "SOF00"
                            ? "/municipality/SOF"
                            : `/settlement/${code}`,
                      })
                    }
                    onMouseEnter={(e) => {
                      const info = findMunicipality(code);
                      const displayName =
                        code === "SOF00"
                          ? t("local_region_sofia_city")
                          : info
                            ? isBg
                              ? info.long_name || info.name
                              : info.long_name_en || info.name_en
                            : code;
                      tooltipEvents.onMouseEnter(
                        { pageX: e.pageX, pageY: e.pageY },
                        <div className="text-left min-w-[220px]">
                          <div className="text-base font-semibold pb-1.5 border-b border-border mb-1.5">
                            {displayName}
                          </div>
                          {s ? (
                            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                              <span className="text-muted-foreground">
                                {metricLabel}
                              </span>
                              <span className="text-foreground font-medium tabular-nums text-right">
                                {s.x.toFixed(1)}%
                                {s.groupCount !== undefined ? (
                                  <span className="text-muted-foreground font-normal ml-1">
                                    ({formatThousands(s.groupCount)})
                                  </span>
                                ) : null}
                              </span>
                              <span className="text-muted-foreground">
                                {partyInfo
                                  ? partyLabel(partyInfo.nickName)
                                  : t("party")}
                              </span>
                              <span
                                className="font-semibold tabular-nums text-right"
                                style={{ color: partyColorStr }}
                              >
                                {s.y.toFixed(1)}%
                                <span className="text-muted-foreground font-normal ml-1">
                                  ({formatThousands(s.partyVotes)})
                                </span>
                              </span>
                              <span className="text-muted-foreground">
                                {t("census_map_relationship")}
                              </span>
                              <span
                                className="font-medium text-right"
                                style={{
                                  color: rgbStr(
                                    s.c >= 0 ? partyRgb : opposingRgb,
                                  ),
                                }}
                              >
                                {t(
                                  s.c >= 0
                                    ? "census_map_aligned"
                                    : "census_map_reversed",
                                )}
                              </span>
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground">
                              {t("census_map_no_data")}
                            </div>
                          )}
                          <div className="text-[10px] text-muted-foreground italic mt-1.5 pt-1.5 border-t border-border">
                            {t("census_tooltip_click_hint")}
                          </div>
                        </div>,
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
          </>
        )}
      </div>
      {tooltip}

      <p className="text-xs text-muted-foreground mt-2">
        {t("census_map_note", { date: selected })}
      </p>
    </div>
  );
};
