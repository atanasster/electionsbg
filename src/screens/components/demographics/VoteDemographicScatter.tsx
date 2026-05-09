import { useCallback, useMemo } from "react";
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
import { NUTS3_TO_OBLAST } from "@/data/census/oblastJoin";
import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useElectionContext } from "@/data/ElectionContext";
import { useTooltip } from "@/ux/useTooltip";
import { useSearchParam } from "@/screens/utils/useSearchParam";
import { MetricSelector } from "./MetricSelector";
import { METRIC_BY_KEY } from "./censusMetrics";
import type { CensusMetric } from "@/data/census/censusTypes";

const PERCENT_METRICS: CensusMetric[] = [
  "ethnicBulgarian",
  "ethnicTurkish",
  "ethnicRoma",
  "religionChristian",
  "religionMuslim",
  "religionNoneOrUndecl",
  "eduTertiary",
  "eduSecondary",
  "eduPrimaryOrLower",
  "ageUnder15",
  "age65plus",
  "employmentRate",
  "unemploymentRate",
  "activityRate",
];

// Pearson correlation. Returns 0 when sample is too small or variance is 0.
const pearson = (xs: number[], ys: number[]): number => {
  const n = xs.length;
  if (n < 3) return 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
};

export const VoteDemographicScatter: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { tooltip, ...tooltipEvents } = useTooltip();
  const { data: census } = useCensus();
  const { countryRegions } = useRegionVotes();
  const { parties, findParty } = usePartyInfo();
  const { selected } = useElectionContext();

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
  const setPartyNum = useCallback(
    (n: number) => {
      setScatterPartyParam(String(n));
    },
    [setScatterPartyParam],
  );

  const lang = i18n.language;
  const isBg = lang === "bg";

  const eligibleParties = useMemo(() => {
    if (!parties) return [];
    return parties.slice().sort((a, b) => a.number - b.number);
  }, [parties]);

  // Default to top-vote party once available
  const effectivePartyNum = useMemo(() => {
    if (partyNum !== undefined) return partyNum;
    const totals = new Map<number, number>();
    const votes = countryRegions();
    if (!votes) return undefined;
    for (const region of votes) {
      for (const v of region.results.votes) {
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
  }, [partyNum, countryRegions]);

  const dataPoints = useMemo(() => {
    if (!census || effectivePartyNum === undefined) return [];
    const votes = countryRegions();
    if (!votes) return [];
    const points: {
      oblast: string;
      nameBg: string;
      nameEn: string;
      x: number; // demographic %
      y: number; // party vote share %
      regionRoute: string;
      totalVotes: number;
    }[] = [];
    // Aggregate by NSI oblast (so Sofia 23/24/25 collapse into one SOF bubble
    // and PDV/PDV-00 into PDV).
    const oblastVotes = new Map<
      string,
      { partyVotes: number; totalVotes: number; nuts3List: Set<string> }
    >();
    for (const region of votes) {
      const oblastCode = NUTS3_TO_OBLAST[region.nuts3];
      if (!oblastCode) continue;
      const partyV = region.results.votes.find(
        (v) => v.partyNum === effectivePartyNum,
      );
      const total = region.results.votes.reduce((s, v) => s + v.totalVotes, 0);
      const entry = oblastVotes.get(oblastCode) ?? {
        partyVotes: 0,
        totalVotes: 0,
        nuts3List: new Set<string>(),
      };
      entry.partyVotes += partyV?.totalVotes ?? 0;
      entry.totalVotes += total;
      entry.nuts3List.add(region.nuts3);
      oblastVotes.set(oblastCode, entry);
    }
    for (const [oblastCode, agg] of oblastVotes) {
      const entity = census.oblasts.find((o) => o.code === oblastCode);
      if (!entity) continue;
      const xRaw = censusMetricValue(entity, metric);
      if (xRaw === undefined || agg.totalVotes <= 0) continue;
      points.push({
        oblast: oblastCode,
        nameBg: entity.nameBg,
        nameEn: entity.nameEn,
        x: xRaw * 100,
        y: (agg.partyVotes / agg.totalVotes) * 100,
        regionRoute: `/municipality/${oblastCode}`,
        totalVotes: agg.totalVotes,
      });
    }
    return points;
  }, [census, countryRegions, effectivePartyNum, metric]);

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
    <div>
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
                {partyInfo
                  ? isBg
                    ? partyInfo.nickName
                    : partyInfo.nickName_en || partyInfo.nickName
                  : ""}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {eligibleParties.map((p) => (
                <SelectItem key={p.number} value={String(p.number)}>
                  {isBg ? p.nickName : p.nickName_en || p.nickName}
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
      <div className="relative">
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
            {partyInfo
              ? `${isBg ? partyInfo.nickName : partyInfo.nickName_en || partyInfo.nickName} %`
              : ""}
          </text>
          {dataPoints.map((p) => (
            <g key={p.oblast}>
              <Link to={p.regionRoute} role="link">
                <circle
                  cx={xScale(p.x)}
                  cy={yScale(p.y)}
                  r={Math.max(4, Math.sqrt(p.totalVotes) / 30)}
                  fill={partyColor}
                  fillOpacity={0.7}
                  stroke="white"
                  strokeWidth={1.2}
                  cursor="pointer"
                  onMouseEnter={(e) =>
                    tooltipEvents.onMouseEnter(
                      { pageX: e.pageX, pageY: e.pageY },
                      <div className="text-left">
                        <div className="text-base font-semibold pb-1">
                          {isBg ? p.nameBg : p.nameEn}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {metricLabel}:{" "}
                          <span className="text-foreground font-medium">
                            {p.x.toFixed(1)}%
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {partyInfo
                            ? isBg
                              ? partyInfo.nickName
                              : partyInfo.nickName_en || partyInfo.nickName
                            : "Party"}
                          :{" "}
                          <span className="text-foreground font-medium">
                            {p.y.toFixed(1)}%
                          </span>
                        </div>
                      </div>,
                    )
                  }
                  onMouseMove={(e) =>
                    tooltipEvents.onMouseMove({
                      pageX: e.pageX,
                      pageY: e.pageY,
                    })
                  }
                  onMouseLeave={tooltipEvents.onMouseLeave}
                />
              </Link>
            </g>
          ))}
        </svg>
        {tooltip}
      </div>
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
              party: partyInfo
                ? isBg
                  ? partyInfo.nickName
                  : partyInfo.nickName_en || partyInfo.nickName
                : "",
              metric: metricLabel,
              r: correlation.toFixed(2),
            },
          )}
        </p>
      )}
    </div>
  );
};
