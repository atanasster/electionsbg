import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
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
import { useTooltip } from "@/ux/useTooltip";
import { useSearchParam } from "@/screens/utils/useSearchParam";
import { formatThousands } from "@/data/utils";
import { MetricSelector } from "./MetricSelector";
import { METRIC_BY_KEY } from "./censusMetrics";
import {
  PERCENT_METRICS,
  pearson,
  censusMetricCount,
} from "./voteDemographicCorrelation";
import type { CensusMetric } from "@/data/census/censusTypes";

export const VoteDemographicScatter: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { tooltip, ...tooltipEvents } = useTooltip();
  const { data: census } = useCensus();
  const { data: voteDemo } = useVoteDemographics();
  const { parties, findParty } = usePartyInfo();
  const { displayNameFor } = useCanonicalParties();
  const { selected } = useElectionContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredCode, setHoveredCode] = useState<string | undefined>();

  const DEFAULT_METRIC: CensusMetric = "eduSecondary";
  const [scatterMetricParam, setScatterMetricParam] = useSearchParam(
    "scatter",
    { replace: true },
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
    (m: CensusMetric) => {
      setScatterMetricParam(m === DEFAULT_METRIC ? undefined : m);
    },
    [setScatterMetricParam, DEFAULT_METRIC],
  );
  const partyNum: number | undefined = scatterPartyParam
    ? Number(scatterPartyParam)
    : undefined;

  // When the scatter is deep-linked from outside (e.g. the party dashboard's
  // Demographic profile tile), scroll it into view so users land on the chart
  // they clicked rather than the top of the demographics page.
  useEffect(() => {
    if (scatterPartyParam && containerRef.current) {
      containerRef.current.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setPartyNum = useCallback(
    (n: number) => {
      setScatterPartyParam(String(n));
    },
    [setScatterPartyParam],
  );

  const lang = i18n.language;
  const isBg = lang === "bg";

  // English UI shows the canonical English short label; Bulgarian keeps the
  // election-specific ballot nickname verbatim.
  const partyLabel = (nickName: string) =>
    isBg ? nickName : (displayNameFor(nickName) ?? nickName);

  const eligibleParties = useMemo(() => {
    if (!parties) return [];
    return parties.slice().sort((a, b) => a.number - b.number);
  }, [parties]);

  // Default to top-vote party once available
  const effectivePartyNum = useMemo(() => {
    if (partyNum !== undefined) return partyNum;
    if (!voteDemo) return undefined;
    const totals = new Map<number, number>();
    for (const muni of voteDemo.municipalities) {
      for (const v of muni.votes) {
        totals.set(v.partyNum, (totals.get(v.partyNum) ?? 0) + v.totalVotes);
      }
    }
    let best: number | undefined;
    let bestVal = -1;
    for (const [k, v] of totals) {
      if (v > bestVal) {
        bestVal = v;
        best = k;
      }
    }
    return best;
  }, [partyNum, voteDemo]);

  const dataPoints = useMemo(() => {
    if (!census || !voteDemo || effectivePartyNum === undefined) return [];
    const points: {
      code: string;
      nameBg: string;
      nameEn: string;
      x: number; // demographic %
      y: number; // party vote share %
      regionRoute: string;
      partyVotes: number;
      totalVotes: number;
      population: number;
      groupCount?: number;
    }[] = [];
    // One bubble per municipality. Census dimensions are joined by obshtina
    // code; Sofia city is already aggregated into SOF46 by the data pipeline.
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
      points.push({
        code: muni.obshtina,
        nameBg: entity.nameBg,
        nameEn: entity.nameEn,
        x: xRaw * 100,
        y: (partyVotes / total) * 100,
        // Per-municipality drilldown lives at /settlement/<obshtina>. Sofia
        // city (SOF46) has no single municipality page — the election data
        // splits it into rayon units — so it points at its oblast page.
        regionRoute:
          muni.obshtina === "SOF46"
            ? "/municipality/SOF"
            : `/settlement/${muni.obshtina}`,
        partyVotes,
        totalVotes: total,
        population: entity.population,
        groupCount: censusMetricCount(entity, metric),
      });
    }
    return points;
  }, [census, voteDemo, effectivePartyNum, metric]);

  const correlation = useMemo(
    () =>
      pearson(
        dataPoints.map((p) => p.x),
        dataPoints.map((p) => p.y),
      ),
    [dataPoints],
  );

  if (!census || !PERCENT_METRICS.includes(metric)) {
    return null;
  }

  const xs = dataPoints.map((p) => p.x);
  const ys = dataPoints.map((p) => p.y);
  const xMin = Math.min(...xs, 0);
  const xMax = Math.max(...xs, 1);
  const yMin = Math.min(...ys, 0);
  const yMax = Math.max(...ys, 1);
  const xPad = (xMax - xMin) * 0.05 || 1;
  const yPad = (yMax - yMin) * 0.05 || 1;
  const xDomain: [number, number] = [
    Math.max(0, xMin - xPad),
    Math.min(100, xMax + xPad),
  ];
  const yDomain: [number, number] = [
    Math.max(0, yMin - yPad),
    Math.min(100, yMax + yPad),
  ];

  const W = 720;
  const H = 420;
  const PAD = { top: 16, right: 16, bottom: 36, left: 44 };

  const xScale = (v: number) =>
    PAD.left +
    ((v - xDomain[0]) / (xDomain[1] - xDomain[0])) * (W - PAD.left - PAD.right);
  const yScale = (v: number) =>
    H -
    PAD.bottom -
    ((v - yDomain[0]) / (yDomain[1] - yDomain[0])) * (H - PAD.top - PAD.bottom);

  const partyInfo =
    effectivePartyNum !== undefined ? findParty(effectivePartyNum) : undefined;
  const partyColor = partyInfo?.color ?? "hsl(213, 70%, 55%)";
  const metricLabel = t(METRIC_BY_KEY[metric].i18nKey);

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
          <MetricSelector value={metric} onChange={setMetric} />
        </div>
        <div className="ml-auto text-sm">
          <span className="text-muted-foreground mr-2">
            {t("census_correlation")}:
          </span>
          <span
            className="font-semibold tabular-nums"
            style={{
              color:
                correlation > 0.4
                  ? "hsl(140, 60%, 40%)"
                  : correlation < -0.4
                    ? "hsl(0, 70%, 50%)"
                    : "hsl(0, 0%, 50%)",
            }}
          >
            {correlation.toFixed(2)}
          </span>
        </div>
      </div>
      <div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
          {/* axes */}
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={H - PAD.bottom}
            y2={H - PAD.bottom}
            stroke="hsl(var(--border))"
          />
          <line
            x1={PAD.left}
            x2={PAD.left}
            y1={PAD.top}
            y2={H - PAD.bottom}
            stroke="hsl(var(--border))"
          />
          {/* gridlines/ticks at 25%/50%/75% of each axis */}
          {[0.25, 0.5, 0.75].map((t, i) => {
            const xv = xDomain[0] + (xDomain[1] - xDomain[0]) * t;
            const yv = yDomain[0] + (yDomain[1] - yDomain[0]) * t;
            return (
              <g key={i} className="text-[10px] fill-muted-foreground">
                <line
                  x1={xScale(xv)}
                  x2={xScale(xv)}
                  y1={H - PAD.bottom}
                  y2={H - PAD.bottom + 4}
                  stroke="hsl(var(--muted-foreground))"
                  opacity={0.5}
                />
                <text
                  x={xScale(xv)}
                  y={H - PAD.bottom + 16}
                  textAnchor="middle"
                >
                  {xv.toFixed(0)}%
                </text>
                <line
                  x1={PAD.left - 4}
                  x2={PAD.left}
                  y1={yScale(yv)}
                  y2={yScale(yv)}
                  stroke="hsl(var(--muted-foreground))"
                  opacity={0.5}
                />
                <text x={PAD.left - 6} y={yScale(yv) + 4} textAnchor="end">
                  {yv.toFixed(0)}%
                </text>
              </g>
            );
          })}
          {/* axis labels */}
          <text
            x={(W + PAD.left - PAD.right) / 2}
            y={H - 4}
            textAnchor="middle"
            className="fill-foreground text-xs font-medium"
          >
            {metricLabel}
          </text>
          <text
            transform={`translate(12 ${(H + PAD.top - PAD.bottom) / 2}) rotate(-90)`}
            textAnchor="middle"
            className="fill-foreground text-xs font-medium"
          >
            {partyInfo ? `${partyLabel(partyInfo.nickName)} %` : ""}
          </text>
          {dataPoints.map((p) => {
            const partyName = partyInfo
              ? partyLabel(partyInfo.nickName)
              : t("party");
            const isHovered = hoveredCode === p.code;
            return (
              <g key={p.code}>
                <Link to={p.regionRoute} role="link">
                  <circle
                    cx={xScale(p.x)}
                    cy={yScale(p.y)}
                    r={Math.max(4, Math.sqrt(p.totalVotes) / 30)}
                    fill={partyColor}
                    fillOpacity={isHovered ? 0.95 : 0.7}
                    stroke={isHovered ? "hsl(var(--foreground))" : "white"}
                    strokeWidth={isHovered ? 2.5 : 1.2}
                    cursor="pointer"
                    onMouseEnter={(e) => {
                      setHoveredCode(p.code);
                      tooltipEvents.onMouseEnter(
                        { pageX: e.pageX, pageY: e.pageY },
                        <div className="text-left min-w-[220px]">
                          <div className="text-base font-semibold pb-1.5 border-b border-border mb-1.5">
                            {isBg ? p.nameBg : p.nameEn}
                          </div>
                          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                            <span className="text-muted-foreground">
                              {metricLabel}
                            </span>
                            <span className="text-foreground font-medium tabular-nums text-right">
                              {p.x.toFixed(1)}%
                              {p.groupCount !== undefined ? (
                                <span className="text-muted-foreground font-normal ml-1">
                                  ({formatThousands(p.groupCount)})
                                </span>
                              ) : null}
                            </span>
                            <span className="text-muted-foreground">
                              {partyName}
                            </span>
                            <span
                              className="font-semibold tabular-nums text-right"
                              style={{ color: partyColor }}
                            >
                              {p.y.toFixed(1)}%
                              <span className="text-muted-foreground font-normal ml-1">
                                ({formatThousands(p.partyVotes)})
                              </span>
                            </span>
                            <span className="text-muted-foreground">
                              {t("census_tooltip_total_votes")}
                            </span>
                            <span className="text-foreground font-medium tabular-nums text-right">
                              {formatThousands(p.totalVotes)}
                            </span>
                            <span className="text-muted-foreground">
                              {t("census_tooltip_population")}
                            </span>
                            <span className="text-foreground font-medium tabular-nums text-right">
                              {formatThousands(p.population)}
                            </span>
                          </div>
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
                    onMouseLeave={() => {
                      setHoveredCode(undefined);
                      tooltipEvents.onMouseLeave();
                    }}
                  />
                </Link>
              </g>
            );
          })}
        </svg>
      </div>
      {tooltip}
      <p className="text-xs text-muted-foreground mt-2">
        {t("census_scatter_note", { date: selected })}
      </p>
      {Math.abs(correlation) >= 0.5 && (
        <p className="text-xs text-muted-foreground italic mt-1">
          {t(
            correlation > 0
              ? "census_correlation_positive"
              : "census_correlation_negative",
            {
              party: partyInfo ? partyLabel(partyInfo.nickName) : "",
              metric: metricLabel,
              r: correlation.toFixed(2),
            },
          )}
        </p>
      )}
    </div>
  );
};
