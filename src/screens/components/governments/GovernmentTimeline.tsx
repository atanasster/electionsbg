import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Government,
  GovernmentEndReason,
} from "@/data/governments/useGovernments";
import {
  MacroIndicatorKey,
  MacroPayload,
  labelForFractionalX,
  pointToFractionalX,
} from "@/data/macro/useMacro";
import { Tooltip as UxTooltip } from "@/ux/Tooltip";
import { tooltipSurfaceClass } from "@/components/ui/tooltipSurface";
import { cn } from "@/lib/utils";
import { useMps } from "@/data/parliament/useMps";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import {
  toFractionalYear,
  xDomainFor,
} from "@/screens/components/governments/governmentTimelineUtils";
import { useChartInsets } from "@/screens/components/governments/governmentChartInsets";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";

const ELECTION_DATES = [
  "2005_06_25",
  "2009_07_05",
  "2013_05_12",
  "2014_10_05",
  "2017_03_26",
  "2021_04_04",
  "2021_07_11",
  "2021_11_14",
  "2022_10_02",
  "2023_04_02",
  "2024_06_09",
  "2024_10_27",
  "2026_04_19",
];

const isoFromElectionKey = (key: string) => key.replace(/_/g, "-");

type ColorResolver = (nickName: string) => string | undefined;

const FALLBACK_PARTY_COLOR = "#475569";

// Caretaker fallbacks for the historical predecessor labels we still ship in
// public/governments.json — these aren't current CEC nicknames, so the
// canonical resolver doesn't know them.
const LEGACY_PARTY_COLORS: Record<string, string> = {
  "Реформаторски блок": "#9b59b6",
  "Патриотичен фронт": "#7f8c8d",
  "Обединени патриоти": "#7f8c8d",
};

const resolvePartyColor = (
  nickName: string | undefined,
  colorFor: ColorResolver,
): string => {
  if (!nickName) return FALLBACK_PARTY_COLOR;
  return (
    colorFor(nickName) ?? LEGACY_PARTY_COLORS[nickName] ?? FALLBACK_PARTY_COLOR
  );
};

// Recharts/inline-style consumers need a string colour, so normalise rgb()/
// rgba()/hex inputs into the same rgba() representation with a chosen alpha.
const withAlpha = (color: string, alpha: number): string => {
  const trimmed = color.trim();
  const rgbMatch = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) {
    return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${alpha})`;
  }
  if (trimmed.startsWith("#")) {
    const h = trimmed.slice(1);
    const expand =
      h.length === 3
        ? h
            .split("")
            .map((c) => c + c)
            .join("")
        : h;
    const r = parseInt(expand.slice(0, 2), 16);
    const g = parseInt(expand.slice(2, 4), 16);
    const b = parseInt(expand.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return trimmed;
};

const colorForGovernment = (
  g: Government,
  colorFor: ColorResolver,
  alpha = 0.18,
): string => {
  if (g.type === "caretaker") return `rgba(120, 120, 120, ${alpha})`;
  return withAlpha(resolvePartyColor(g.parties[0], colorFor), alpha);
};

const colorForGovernmentSolid = (
  g: Government,
  colorFor: ColorResolver,
): string => {
  if (g.type === "caretaker") return "#94a3b8";
  return resolvePartyColor(g.parties[0], colorFor);
};

// Reused per chart so the line palette stays consistent across the page.
// Colours may repeat across charts (gdpGrowth and inflationCore both green,
// inflation and inflationEnergy both red) — they never appear in the same
// chart together, so within-chart contrast is what matters.
const SERIES_COLORS: Record<MacroIndicatorKey, string> = {
  // economy
  gdpGrowth: "#10b981",
  inflation: "#ef4444",
  unemployment: "#3b82f6",
  gdpPerCapita: "#a855f7",
  nominalGdp: "#d946ef",
  // fiscal / external
  govDebt: "#0891b2",
  budgetBalance: "#e11d48",
  currentAccount: "#7c3aed",
  // HICP breakdown (stacked area uses these directly)
  inflationFood: "#f59e0b",
  inflationEnergy: "#dc2626",
  inflationServices: "#3b82f6",
  inflationCore: "#10b981",
  // activity (index 2021 = 100) + labour income (% YoY)
  industrialProd: "#047857",
  retailVolume: "#0d9488",
  labourIncome: "#65a30d",
  // sentiment (different scales — own chart)
  consumerConfidence: "#38bdf8",
  economicSentiment: "#4f46e5",
  // social
  youthUnemployment: "#1d4ed8",
  housePricesYoY: "#a16207",
  gini: "#7c3aed",
  povertyRate: "#be185d",
  // governance / curated
  wgiRuleOfLaw: "#0ea5e9",
  wgiControlOfCorruption: "#8b5cf6",
  wgiGovEffectiveness: "#06b6d4",
  cpi: "#f59e0b",
  trustParliament: "#dc2626",
  trustGovernment: "#0d9488",
  trustEu: "#2563eb",
  euFunds: "#6366f1",
  euContribution: "#f97316",
};

// Rows are keyed by fractional year (mid-year for annual, mid-quarter for
// quarterly). Sparse — most cells are undefined when cadences are mixed,
// which is fine because `<Line connectNulls>` handles it.
type ChartRow = { x: number } & Partial<Record<MacroIndicatorKey, number>>;

const buildChartData = (
  macro: MacroPayload | undefined,
  keys: MacroIndicatorKey[],
): ChartRow[] => {
  if (!macro) return [];
  const rows = new Map<number, ChartRow>();
  for (const k of keys) {
    for (const p of macro.series[k] ?? []) {
      const x = pointToFractionalX(p);
      const row = rows.get(x) ?? { x };
      row[k] = p.value;
      rows.set(x, row);
    }
  }
  return [...rows.values()].sort((a, b) => a.x - b.x);
};

type Toggle = Partial<Record<MacroIndicatorKey, boolean>>;

const TooltipContent: FC<{
  active?: boolean;
  payload?: { value: number; dataKey: string; color: string }[];
  label?: number;
  governments: Government[];
  lang: "en" | "bg";
  indicatorTitles: MacroPayload["indicators"];
  enabled: Toggle;
  caretakerLabel: string;
  regularLabel: string;
  unitFormatter: (key: MacroIndicatorKey, value: number) => string;
}> = ({
  active,
  payload,
  label,
  governments,
  lang,
  indicatorTitles,
  enabled,
  caretakerLabel,
  regularLabel,
  unitFormatter,
}) => {
  if (!active || label === undefined) return null;
  // label is the fractional x of the hovered row — match cabinets in office
  // at that instant rather than at year resolution.
  const t = label;
  const matching = governments.filter((g) => {
    const s = toFractionalYear(g.startDate);
    const e = g.endDate ? toFractionalYear(g.endDate) : 9999;
    return s <= t && e >= t;
  });
  return (
    <div className={cn(tooltipSurfaceClass, "px-3 py-2 text-xs max-w-xs")}>
      <div className="font-semibold mb-1">{labelForFractionalX(label)}</div>
      {matching.map((g) => (
        <div key={g.id} className="mb-0.5">
          <span className="font-semibold">
            {lang === "bg" ? g.pmBg : g.pmEn}
          </span>
          <span className="ml-1 text-muted-foreground">
            ({g.type === "caretaker" ? caretakerLabel : regularLabel})
          </span>
        </div>
      ))}
      <div className="mt-1 border-t border-border pt-1 flex flex-col gap-0.5">
        {payload
          ?.filter((p) => enabled[p.dataKey as MacroIndicatorKey])
          .map((p) => {
            const meta = indicatorTitles[p.dataKey as MacroIndicatorKey];
            return (
              <div key={p.dataKey} className="flex justify-between gap-2">
                <span style={{ color: p.color }}>
                  {lang === "bg" ? meta.titleBg : meta.titleEn}
                </span>
                <span className="font-semibold tabular-nums">
                  {typeof p.value === "number"
                    ? unitFormatter(p.dataKey as MacroIndicatorKey, p.value)
                    : "—"}
                </span>
              </div>
            );
          })}
      </div>
    </div>
  );
};

// Cabinet strip rendered as a flex row above the chart. Padding mirrors the
// chart's left margin (8) + YAxis width (36) and right margin (32) so each
// pill aligns with the plot area below.
//
// Cabinets vary widely in tenure (Borisov-III ran 4 years; the Райков caretaker
// ran ~2.5 months). Wide pills get horizontal text; narrow ones use rotated
// (vertical) text so the surname still reads. Pills below ~1% of the timeline
// drop the label entirely — the colour band + tooltip carry the identification.
// On phone-width viewports the timeline is only ~300px wide, so even a 4-year
// pill is too narrow for a 7–9 char Bulgarian surname horizontal. We force
// every pill vertical and make the strip taller (h-24 ≈ 96px) so the full
// surname fits.
const PILL_HORIZONTAL_THRESHOLD_DESKTOP = 5; // pct width
const PILL_HORIZONTAL_THRESHOLD_MOBILE = Infinity; // never horizontal
const PILL_LABEL_THRESHOLD = 1; // pct width

const formatDateLocal = (iso: string | null, lang: "en" | "bg"): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(lang === "bg" ? "bg-BG" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const PillTooltip: FC<{
  g: Government;
  lang: "en" | "bg";
}> = ({ g, lang }) => {
  const { t } = useTranslation();
  const { findMpByName } = useMps();
  const endReasonMap: Record<GovernmentEndReason, string> = {
    term_end: t("gov_end_term_end"),
    election: t("gov_end_election"),
    snap_election: t("gov_end_snap_election"),
    no_confidence: t("gov_end_no_confidence"),
    resignation: t("gov_end_resignation"),
    rotation_failed: t("gov_end_rotation_failed"),
    incumbent: t("gov_end_incumbent"),
  };
  const fullName = lang === "bg" ? g.pmBg : g.pmEn;
  const parties = lang === "bg" ? g.parties : (g.partiesEn ?? g.parties);
  const endReasonText = lang === "bg" ? g.endReasonBg : g.endReasonEn;
  const mp = findMpByName(g.pmBg);
  const isCaretaker = g.type === "caretaker";
  const pmPartyLabel = isCaretaker
    ? lang === "bg"
      ? g.pmPartyBg
      : (g.pmPartyEn ?? g.pmPartyBg)
    : parties[0];
  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <div className="flex items-center gap-2">
        <MpAvatar
          name={g.pmBg}
          mpId={mp?.id}
          className="h-7 w-7"
          showPartyRing={false}
        />
        <div className="flex flex-col leading-tight min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold">{fullName}</span>
            <span className="opacity-70">
              ({isCaretaker ? t("gov_type_caretaker") : t("gov_type_regular")})
            </span>
          </div>
          {pmPartyLabel ? (
            <span className="text-[10px] uppercase tracking-wide opacity-70">
              {isCaretaker ? `(${pmPartyLabel})` : pmPartyLabel}
            </span>
          ) : null}
        </div>
      </div>
      <div className="opacity-80 tabular-nums">
        {formatDateLocal(g.startDate, lang)} –{" "}
        {formatDateLocal(g.endDate, lang)}
      </div>
      {parties.length > 0 && (
        <div className="opacity-80">{parties.join(", ")}</div>
      )}
      <div className="opacity-90 italic">
        {endReasonMap[g.endReason]}
        {g.endReason !== "incumbent" && endReasonText
          ? ` — ${endReasonText}`
          : ""}
      </div>
    </div>
  );
};

export const CabinetStrip: FC<{
  governments: Government[];
  xDomain: [number, number];
  lang: "en" | "bg";
}> = ({ governments, xDomain, lang }) => {
  const { colorFor } = useCanonicalParties();
  const insets = useChartInsets();
  const isSmall = useMediaQueryMatch("sm");
  const horizontalThreshold = isSmall
    ? PILL_HORIZONTAL_THRESHOLD_MOBILE
    : PILL_HORIZONTAL_THRESHOLD_DESKTOP;
  return (
    <div
      className={cn(
        "flex mb-1 rounded overflow-hidden",
        isSmall ? "h-24" : "h-14",
      )}
      style={{
        paddingLeft: insets.paddingLeft,
        paddingRight: insets.paddingRight,
      }}
    >
      {governments.map((g) => {
        const start = toFractionalYear(g.startDate);
        const end = toFractionalYear(g.endDate ?? new Date().toISOString());
        const widthPct = ((end - start) / (xDomain[1] - xDomain[0])) * 100;
        const surname =
          (lang === "bg" ? g.pmBg : g.pmEn).split(" ").pop() ?? "";
        const horizontal = widthPct >= horizontalThreshold;
        const showLabel = widthPct >= PILL_LABEL_THRESHOLD;
        return (
          <UxTooltip
            key={`pill-${g.id}`}
            content={<PillTooltip g={g} lang={lang} />}
          >
            <div
              className="h-full flex items-center justify-center text-[10px] font-medium overflow-hidden border-r border-background/40 last:border-r-0 cursor-help"
              style={{
                width: `${widthPct}%`,
                backgroundColor: colorForGovernmentSolid(g, colorFor),
                color:
                  g.type === "caretaker" ? "rgba(255,255,255,0.95)" : "#fff",
                opacity: g.type === "caretaker" ? 0.6 : 0.95,
              }}
            >
              {showLabel && horizontal && (
                <span className="truncate px-1">{surname}</span>
              )}
              {showLabel && !horizontal && (
                <span
                  className="px-0.5 leading-none whitespace-nowrap"
                  style={{
                    writingMode: "vertical-rl",
                    transform: "rotate(180deg)",
                  }}
                >
                  {surname}
                </span>
              )}
            </div>
          </UxTooltip>
        );
      })}
    </div>
  );
};

// Either a flat list of indicator keys (one ungrouped row of pills above the
// chart) or labelled groups (one row per group with a small leading label).
// Grouped form is used when a single chart hosts >5 indicators or distinct
// conceptual buckets (e.g. headline + activity + sentiment).
export type IndicatorGroup = {
  labelKey: string;
  keys: MacroIndicatorKey[];
};
export type IndicatorSpec = MacroIndicatorKey[] | IndicatorGroup[];

// Vertical reference line + label, used to flag a one-off event on the
// chart (e.g. the 2008 EU funds suspension). Drawn on top of the cabinet
// bands and election ticks. Keep markers sparse — they compete visually
// with the election lines.
export type EventMarker = {
  /** Fractional year position (e.g. 2008.55 ≈ late July). */
  x: number;
  /** Short label shown next to the line. */
  label: string;
  /** Line/label colour. Defaults to a muted amber. */
  color?: string;
};

const flattenSpec = (spec: IndicatorSpec): MacroIndicatorKey[] =>
  Array.isArray(spec) && spec.length > 0 && typeof spec[0] === "string"
    ? (spec as MacroIndicatorKey[])
    : (spec as IndicatorGroup[]).flatMap((g) => g.keys);

const isGrouped = (spec: IndicatorSpec): spec is IndicatorGroup[] =>
  Array.isArray(spec) && spec.length > 0 && typeof spec[0] !== "string";

export const GovernmentTimeline: FC<{
  governments: Government[];
  macro: MacroPayload | undefined;
  /**
   * Which indicator series this chart can show. Pass a flat array for one
   * row of pills, or a list of `{labelKey, keys}` groups for category rows.
   */
  indicatorKeys: IndicatorSpec;
  /** Subset of indicator keys enabled by default. Defaults to all. */
  defaultEnabled?: MacroIndicatorKey[];
  /** Y-axis tick formatter. */
  yAxisFormatter?: (v: number) => string;
  /** Optional fixed Y-axis domain (pass to override Recharts' auto-scale). */
  yDomain?: [number, number] | [number | "auto", number | "auto"];
  /** Tooltip value formatter — falls back to yAxisFormatter when omitted. */
  unitFormatter?: (key: MacroIndicatorKey, value: number) => string;
  /** Chart height (px). Default 360. */
  height?: number;
  /** Show a horizontal y=0 reference line. Useful for signed indicators. */
  showZeroLine?: boolean;
  /** Hide the per-series toggle pills above the chart. Used by the dashboard
      tile where a glanceable view matters more than per-series interaction. */
  hideToggles?: boolean;
  /** Optional one-off event markers (vertical line + label) layered on top
      of the cabinet bands and election ticks. Use sparingly. */
  eventMarkers?: EventMarker[];
}> = ({
  governments,
  macro,
  indicatorKeys,
  defaultEnabled,
  yAxisFormatter = (v) => `${v}`,
  yDomain,
  unitFormatter,
  height = 360,
  showZeroLine,
  hideToggles,
  eventMarkers,
}) => {
  const { t, i18n } = useTranslation();
  const lang: "en" | "bg" = i18n.language === "bg" ? "bg" : "en";
  const { colorFor } = useCanonicalParties();
  const insets = useChartInsets();

  const flatKeys = useMemo(() => flattenSpec(indicatorKeys), [indicatorKeys]);

  const initial = useMemo<Toggle>(() => {
    const on = new Set<MacroIndicatorKey>(defaultEnabled ?? flatKeys);
    const out: Toggle = {};
    for (const k of flatKeys) out[k] = on.has(k);
    return out;
  }, [flatKeys, defaultEnabled]);

  const [enabled, setEnabled] = useState<Toggle>(initial);

  const chartData = useMemo(
    () => buildChartData(macro, flatKeys),
    [macro, flatKeys],
  );

  const xDomain = useMemo<[number, number]>(
    () => xDomainFor(governments),
    [governments],
  );

  const toggle = (key: MacroIndicatorKey) =>
    setEnabled((s) => ({ ...s, [key]: !s[key] }));

  const tooltipFormatter =
    unitFormatter ?? ((_k: MacroIndicatorKey, v: number) => yAxisFormatter(v));

  if (!macro || chartData.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        {t("gov_macro_unavailable")}
      </div>
    );
  }

  return (
    <div className="w-full">
      {!hideToggles &&
        (isGrouped(indicatorKeys) ? (
          <div className="mb-3 flex flex-col gap-1.5">
            {indicatorKeys.map((group) => (
              <div
                key={group.labelKey}
                className="flex flex-wrap items-center gap-2 text-xs"
              >
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground min-w-[64px]">
                  {t(group.labelKey)}
                </span>
                {group.keys.map((k) => {
                  const meta = macro.indicators[k];
                  if (!meta) return null;
                  return (
                    <button
                      key={k}
                      onClick={() => toggle(k)}
                      className={`px-3 py-1 rounded-full border transition-colors ${
                        enabled[k]
                          ? "border-transparent text-white"
                          : "bg-background hover:bg-accent/10"
                      }`}
                      style={
                        enabled[k]
                          ? { backgroundColor: SERIES_COLORS[k] }
                          : {
                              borderColor: SERIES_COLORS[k],
                              color: SERIES_COLORS[k],
                            }
                      }
                    >
                      {lang === "bg" ? meta.titleBg : meta.titleEn}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 mb-3 text-xs">
            {flatKeys.map((k) => {
              const meta = macro.indicators[k];
              if (!meta) return null;
              return (
                <button
                  key={k}
                  onClick={() => toggle(k)}
                  className={`px-3 py-1 rounded-full border transition-colors ${
                    enabled[k]
                      ? "border-transparent text-white"
                      : "bg-background hover:bg-accent/10"
                  }`}
                  style={
                    enabled[k]
                      ? { backgroundColor: SERIES_COLORS[k] }
                      : {
                          borderColor: SERIES_COLORS[k],
                          color: SERIES_COLORS[k],
                        }
                  }
                >
                  {lang === "bg" ? meta.titleBg : meta.titleEn}
                </button>
              );
            })}
          </div>
        ))}

      <div className="w-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{
              top: 8,
              right: insets.marginRight,
              left: insets.marginLeft,
              bottom: 24,
            }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              opacity={0.2}
            />
            <XAxis
              dataKey="x"
              type="number"
              domain={xDomain}
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              ticks={Array.from(
                { length: Math.ceil(xDomain[1]) - Math.floor(xDomain[0]) + 1 },
                (_, i) => Math.floor(xDomain[0]) + i,
              )}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={insets.yAxisWidth}
              domain={yDomain}
              tickFormatter={yAxisFormatter}
            />
            <Tooltip
              content={
                <TooltipContent
                  governments={governments}
                  lang={lang}
                  indicatorTitles={macro.indicators}
                  enabled={enabled}
                  caretakerLabel={t("gov_type_caretaker")}
                  regularLabel={t("gov_type_regular")}
                  unitFormatter={tooltipFormatter}
                />
              }
            />

            {governments.map((g) => {
              const x1 = toFractionalYear(g.startDate);
              const x2 = toFractionalYear(
                g.endDate ?? new Date().toISOString(),
              );
              return (
                <ReferenceArea
                  key={`band-${g.id}`}
                  x1={x1}
                  x2={x2}
                  fill={colorForGovernment(g, colorFor)}
                  fillOpacity={1}
                  stroke="none"
                  ifOverflow="visible"
                />
              );
            })}

            {ELECTION_DATES.map((key) => {
              const x = toFractionalYear(isoFromElectionKey(key));
              return (
                <ReferenceLine
                  key={`elec-${key}`}
                  x={x}
                  stroke="#64748b"
                  strokeDasharray="3 3"
                  strokeOpacity={0.5}
                />
              );
            })}

            {eventMarkers?.map((m, i) => {
              const color = m.color ?? "#b45309";
              return (
                <ReferenceLine
                  key={`evt-${i}`}
                  x={m.x}
                  stroke={color}
                  strokeWidth={1.5}
                  strokeOpacity={0.8}
                  label={{
                    value: m.label,
                    position: "insideTopRight",
                    fill: color,
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                />
              );
            })}

            {showZeroLine && (
              <ReferenceLine y={0} stroke="#64748b" strokeOpacity={0.3} />
            )}

            {flatKeys.map((k) => {
              if (!enabled[k]) return null;
              // Quarterly series have 4x the points across the same span,
              // so shrink the dot to keep the line readable.
              const quarterly = macro.indicators[k]?.cadence === "quarterly";
              return (
                <Line
                  key={k}
                  type="monotone"
                  dataKey={k}
                  stroke={SERIES_COLORS[k]}
                  strokeWidth={2.5}
                  dot={{ r: quarterly ? 1.5 : 3 }}
                  activeDot={{ r: quarterly ? 3 : 5 }}
                  isAnimationActive={false}
                  connectNulls
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
