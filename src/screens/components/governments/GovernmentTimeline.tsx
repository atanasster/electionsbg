import { FC, ReactElement, useMemo, useState } from "react";
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
import type {
  PeerGeo,
  PeerIndicatorBlock,
  PeerQuarterlyPoint,
} from "@/data/macro/useMacroPeers";
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
import {
  colorForGovernment,
  colorForGovernmentSolid,
} from "@/screens/components/governments/governmentColors";
import { useChartInsets } from "@/screens/components/governments/governmentChartInsets";
import type {
  IndicatorGroup,
  IndicatorSpec,
  IndicatorToggle,
} from "@/screens/components/governments/indicatorToggle";
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
  // nominal fiscal / external
  govDebtNominal: "#0891b2",
  debtIssuance: "#0d9488",
  budgetBalanceNominal: "#e11d48",
  currentAccountNominal: "#7c3aed",
  govRevenue: "#15803d",
  govExpenditure: "#c2410c",
  fdiInward: "#c026d3",
  fiscalReserve: "#0f766e",
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

// Per-indicator peer block. Threading this through makes the chart render
// muted peer lines underneath the BG line; the EU27 dashed reference is
// always shown when present, the four peer-country lines (RO/GR/HU/HR) only
// when the parent flips `peerCompareEnabled` (the IndicatorsScreen-wide
// "Compare" toggle). Optional everywhere — existing callers on Governments
// and dashboard tiles pass nothing and render identically to before.
export type PeerOverlay = Partial<
  Record<MacroIndicatorKey, PeerIndicatorBlock>
>;

// Per-geo stroke colors for peer lines. EU27 is the headline reference and
// uses a neutral slate; the four peers use desaturated flag-tinged hues so
// each country is identifiable at a glance, but always at lower opacity +
// thinner stroke than the BG line.
const PEER_STROKES: Record<
  Exclude<PeerGeo, "BG">,
  { stroke: string; dash?: string; width: number }
> = {
  EU27_2020: { stroke: "#475569", dash: "6 3", width: 1.6 },
  RO: { stroke: "#f59e0b", width: 1.2 },
  GR: { stroke: "#2563eb", width: 1.2 },
  HU: { stroke: "#16a34a", width: 1.2 },
  HR: { stroke: "#be123c", width: 1.2 },
};

const PEER_COUNTRIES_BEYOND_EU: Exclude<PeerGeo, "BG" | "EU27_2020">[] = [
  "RO",
  "GR",
  "HU",
  "HR",
];

// Compose the dataKey we use inside Recharts rows for a peer point. Kept as
// a helper so the render and the row-builder can't drift apart.
const peerDataKey = (indicator: MacroIndicatorKey, geo: PeerGeo): string =>
  `${indicator}__${geo}`;

// Rows are keyed by fractional year (mid-year for annual, mid-quarter for
// quarterly). Sparse — most cells are undefined when cadences are mixed,
// which is fine because `<Line connectNulls>` handles it.
//
// `MacroIndicatorKey` covers the BG columns; peer columns use the
// `indicator__geo` composite key (string) so we widen the type.
type ChartRow = {
  x: number;
} & Partial<Record<MacroIndicatorKey, number>> &
  Record<string, number | undefined>;

const buildChartData = (
  macro: MacroPayload | undefined,
  keys: MacroIndicatorKey[],
  peerOverlay?: PeerOverlay,
): ChartRow[] => {
  if (!macro) return [];
  const rows = new Map<number, ChartRow>();
  for (const k of keys) {
    for (const p of macro.series[k] ?? []) {
      const x = pointToFractionalX(p);
      const row = rows.get(x) ?? ({ x } as ChartRow);
      row[k] = p.value;
      rows.set(x, row);
    }
    const overlay = peerOverlay?.[k];
    if (overlay) {
      const entries = Object.entries(overlay.series) as [
        PeerGeo,
        PeerQuarterlyPoint[] | undefined,
      ][];
      for (const [geo, points] of entries) {
        if (geo === "BG" || !points) continue;
        for (const p of points) {
          const x = pointToFractionalX(p);
          const row = rows.get(x) ?? ({ x } as ChartRow);
          row[peerDataKey(k, geo)] = p.value;
          rows.set(x, row);
        }
      }
    }
  }
  return [...rows.values()].sort((a, b) => a.x - b.x);
};

type Toggle = Partial<Record<MacroIndicatorKey, boolean>>;

const PEER_TOOLTIP_LABEL: Record<
  Exclude<PeerGeo, "BG">,
  { bg: string; en: string }
> = {
  EU27_2020: { bg: "ЕС", en: "EU" },
  RO: { bg: "РО", en: "RO" },
  GR: { bg: "ГР", en: "GR" },
  HU: { bg: "УН", en: "HU" },
  HR: { bg: "ХР", en: "HR" },
};

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

  // Split the recharts payload into BG (bare indicator key) vs peer (composite
  // `indicator__geo` key) entries. We group peers by indicator below so each
  // BG row gets its own peer summary line.
  const bgEntries: { value: number; dataKey: string; color: string }[] = [];
  const peerByIndicator: Record<
    string,
    { geo: Exclude<PeerGeo, "BG">; value: number; color: string }[]
  > = {};
  for (const p of payload ?? []) {
    if (typeof p.value !== "number") continue;
    const dk = p.dataKey;
    const split = dk.indexOf("__");
    if (split < 0) {
      bgEntries.push(p);
      continue;
    }
    const indicator = dk.slice(0, split) as MacroIndicatorKey;
    const geo = dk.slice(split + 2) as Exclude<PeerGeo, "BG">;
    if (!enabled[indicator]) continue;
    (peerByIndicator[indicator] ??= []).push({
      geo,
      value: p.value,
      color: p.color,
    });
  }

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
        {bgEntries
          .filter((p) => enabled[p.dataKey as MacroIndicatorKey])
          .map((p) => {
            const indicator = p.dataKey as MacroIndicatorKey;
            const meta = indicatorTitles[indicator];
            const peers = peerByIndicator[indicator];
            return (
              <div key={p.dataKey} className="flex flex-col">
                <div className="flex justify-between gap-2">
                  <span style={{ color: p.color }}>
                    {lang === "bg" ? meta.titleBg : meta.titleEn}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {unitFormatter(indicator, p.value)}
                  </span>
                </div>
                {peers && peers.length > 0 ? (
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground tabular-nums pl-1">
                    {peers.map((pp) => (
                      <span key={pp.geo} className="inline-flex gap-0.5">
                        <span style={{ color: pp.color }}>
                          {PEER_TOOLTIP_LABEL[pp.geo][lang]}
                        </span>
                        <span>{unitFormatter(indicator, pp.value)}</span>
                      </span>
                    ))}
                  </div>
                ) : null}
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
// Mobile: drop labels for cabinets shorter than ~7 months (3% of a 20-year
// span). Without this, the 2021–2024 cluster of short caretakers (two Янев,
// two Главчев, Близнашки, Герджиков) crowds into adjacent vertical labels
// that read as one merged block. The colour band and tooltip still
// identify each cabinet — only the inline label drops.
const PILL_LABEL_THRESHOLD_MOBILE = 3; // pct width

// Mobile-scrollable layout (standalone strip, no chart x-axis alignment).
// Pills get a min-width floor so every cabinet — including short caretakers —
// fits a vertical Cyrillic surname. Above the floor, widths stay proportional
// to tenure so the timeline metaphor survives. The whole strip overflows the
// viewport and scrolls horizontally; pills wider than HORIZONTAL_PX show
// horizontal text instead of rotated.
const MOBILE_SCROLL_MIN_PILL_PX = 32;
const MOBILE_SCROLL_TARGET_TOTAL_PX = 800;
const MOBILE_SCROLL_HORIZONTAL_PX = 64;

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
  // When true on phone-width viewports, render the strip as a horizontally
  // scrolling row with a per-pill min-width floor so every cabinet — including
  // short caretakers — gets a readable label. Only pass this where the strip
  // is standalone; chart-aligned pages must keep the default (false) layout.
  mobileScrollable?: boolean;
  // When passed, pills become toggle-selectable. Click adds, click again
  // removes — pair with a downstream detail panel on the host screen that
  // renders one card per selected id so two or more cabinets can be compared
  // side by side. Selected pills get a thick high-contrast inset border;
  // non-selected dim so the selection reads at a glance.
  selectedIds?: string[] | null;
  onToggle?: (id: string) => void;
}> = ({
  governments,
  xDomain,
  lang,
  mobileScrollable = false,
  selectedIds,
  onToggle,
}) => {
  const { colorFor } = useCanonicalParties();
  const insets = useChartInsets();
  const isSmall = useMediaQueryMatch("sm");
  const selectable = typeof onToggle === "function";
  const selectedSet = useMemo(() => new Set(selectedIds ?? []), [selectedIds]);
  const anySelected = selectedSet.size > 0;

  if (isSmall && mobileScrollable) {
    const span = xDomain[1] - xDomain[0];
    const pillWidthsPx = governments.map((g) => {
      const start = toFractionalYear(g.startDate);
      const end = toFractionalYear(g.endDate ?? new Date().toISOString());
      const pct = (end - start) / span;
      return Math.max(
        MOBILE_SCROLL_MIN_PILL_PX,
        Math.round(pct * MOBILE_SCROLL_TARGET_TOTAL_PX),
      );
    });
    return (
      <div className="overflow-x-auto pb-1">
        <div className="flex mb-1 rounded overflow-hidden h-24 w-max">
          {governments.map((g, i) => {
            const surname =
              (lang === "bg" ? g.pmBg : g.pmEn).split(" ").pop() ?? "";
            const widthPx = pillWidthsPx[i];
            const horizontal = widthPx >= MOBILE_SCROLL_HORIZONTAL_PX;
            const isSelected = selectable && selectedSet.has(g.id);
            const dim = selectable && anySelected && !isSelected;
            return (
              <UxTooltip
                key={`pill-${g.id}`}
                content={<PillTooltip g={g} lang={lang} />}
              >
                <div
                  role={selectable ? "button" : undefined}
                  tabIndex={selectable ? 0 : undefined}
                  aria-pressed={selectable ? isSelected : undefined}
                  onClick={selectable ? () => onToggle?.(g.id) : undefined}
                  onKeyDown={
                    selectable
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onToggle?.(g.id);
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    "h-full flex items-center justify-center text-[11px] font-medium overflow-hidden border-r border-background/40 last:border-r-0",
                    selectable
                      ? "cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/60"
                      : "cursor-help",
                    isSelected &&
                      "shadow-[inset_0_0_0_2px_#fff,inset_0_0_0_4px_#000] dark:shadow-[inset_0_0_0_2px_#000,inset_0_0_0_4px_#fff]",
                  )}
                  style={{
                    width: `${widthPx}px`,
                    backgroundColor: colorForGovernmentSolid(g, colorFor),
                    color:
                      g.type === "caretaker"
                        ? "rgba(255,255,255,0.95)"
                        : "#fff",
                    opacity:
                      g.type === "caretaker"
                        ? isSelected
                          ? 1
                          : dim
                            ? 0.3
                            : 0.6
                        : isSelected
                          ? 1
                          : dim
                            ? 0.45
                            : 0.95,
                  }}
                >
                  {horizontal ? (
                    <span className="truncate px-1">{surname}</span>
                  ) : (
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
      </div>
    );
  }

  const horizontalThreshold = isSmall
    ? PILL_HORIZONTAL_THRESHOLD_MOBILE
    : PILL_HORIZONTAL_THRESHOLD_DESKTOP;
  const labelThreshold = isSmall
    ? PILL_LABEL_THRESHOLD_MOBILE
    : PILL_LABEL_THRESHOLD;
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
        const showLabel = widthPct >= labelThreshold;
        const isSelected = selectable && selectedSet.has(g.id);
        const dim = selectable && anySelected && !isSelected;
        return (
          <UxTooltip
            key={`pill-${g.id}`}
            content={<PillTooltip g={g} lang={lang} />}
          >
            <div
              role={selectable ? "button" : undefined}
              tabIndex={selectable ? 0 : undefined}
              aria-pressed={selectable ? isSelected : undefined}
              onClick={selectable ? () => onToggle?.(g.id) : undefined}
              onKeyDown={
                selectable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onToggle?.(g.id);
                      }
                    }
                  : undefined
              }
              className={cn(
                "h-full flex items-center justify-center text-[10px] font-medium overflow-hidden border-r border-background/40 last:border-r-0",
                selectable
                  ? "cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/60"
                  : "cursor-help",
                isSelected &&
                  "shadow-[inset_0_0_0_2px_#fff,inset_0_0_0_4px_#000] dark:shadow-[inset_0_0_0_2px_#000,inset_0_0_0_4px_#fff]",
              )}
              style={{
                width: `${widthPct}%`,
                backgroundColor: colorForGovernmentSolid(g, colorFor),
                color:
                  g.type === "caretaker" ? "rgba(255,255,255,0.95)" : "#fff",
                opacity:
                  g.type === "caretaker"
                    ? isSelected
                      ? 1
                      : dim
                        ? 0.3
                        : 0.6
                    : isSelected
                      ? 1
                      : dim
                        ? 0.45
                        : 0.95,
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
  /** Where the label sits relative to the line. Defaults to "top" (centered
      above the line). Use "bottom" to stagger labels when markers cluster. */
  labelPosition?:
    | "top"
    | "bottom"
    | "insideTopRight"
    | "insideBottomRight"
    | "insideTopLeft"
    | "insideBottomLeft";
  /** Extra pixels to push the label away from the chart edge along the
      labelPosition axis. Combine with `labelPosition` to give clustered
      markers four distinct visual rows (e.g. two on "top" with offsets 5 and
      22, two on "bottom" with offsets 5 and 22). */
  labelOffset?: number;
};

export type HorizontalReferenceLine = {
  /** Y-axis value to draw the line at. */
  y: number;
  /** Short label rendered next to the line. */
  label?: string;
  /** Line/label colour. Defaults to a muted amber. */
  color?: string;
  /** Recharts dash pattern; defaults to "4 4". */
  strokeDasharray?: string;
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
  /** Optional horizontal reference lines (constants on the y-axis), e.g. a
      legal floor or policy threshold the series should stay above/below. */
  horizontalReferences?: HorizontalReferenceLine[];
  /** Per-indicator peer data. When present, the chart draws an EU27 dashed
      reference line for each enabled BG indicator that has peer data, and
      (when `peerCompareEnabled` is true) RO/GR/HU/HR ghost lines as well. */
  peerOverlay?: PeerOverlay;
  /** Master "Compare" toggle from the IndicatorsScreen — when true, RO/GR/HU/HR
      peer lines render alongside the EU27 dashed reference. When false, only
      EU27 shows. Has no effect if `peerOverlay` is unset. */
  peerCompareEnabled?: boolean;
  /** Controlled toggle state. Pass alongside `onEnabledChange` to lift the
      per-indicator on/off state out of the chart (used by IndicatorsScreen
      so the peer-snapshot table only renders the rows the chart shows).
      When omitted, the chart manages its own state. */
  enabled?: IndicatorToggle;
  /** Companion setter for the controlled `enabled` prop. */
  onEnabledChange?: (next: IndicatorToggle) => void;
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
  horizontalReferences,
  peerOverlay,
  peerCompareEnabled,
  enabled: controlledEnabled,
  onEnabledChange,
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

  // Dual-mode toggle state. If the parent passes both `enabled` and
  // `onEnabledChange` we run controlled; otherwise we own the state. Mixing
  // the two by passing only one would silently drop changes, so we require
  // both at the type level via the union check below.
  const [internalEnabled, setInternalEnabled] = useState<Toggle>(initial);
  const isControlled =
    controlledEnabled !== undefined && onEnabledChange !== undefined;
  const enabled: Toggle = isControlled ? controlledEnabled : internalEnabled;
  const setEnabled = isControlled
    ? (updater: Toggle | ((prev: Toggle) => Toggle)) => {
        const next =
          typeof updater === "function" ? updater(controlledEnabled) : updater;
        onEnabledChange(next);
      }
    : setInternalEnabled;

  const chartData = useMemo(
    () => buildChartData(macro, flatKeys, peerOverlay),
    [macro, flatKeys, peerOverlay],
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
              // When the Compare toggle is on, dial the cabinet-band alpha
              // down so the four peer-country ghost lines stay legible
              // against the patchwork background.
              const bandAlpha = peerCompareEnabled ? 0.07 : 0.18;
              return (
                <ReferenceArea
                  key={`band-${g.id}`}
                  x1={x1}
                  x2={x2}
                  fill={colorForGovernment(g, colorFor, bandAlpha)}
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
              // The line keeps the amber accent so it reads as a "marker".
              // The label uses foreground + a background-colored stroke halo
              // so it stays readable against any cabinet-band colour
              // (Stanishev red, caretaker purple, Borisov grey) and in both
              // light and dark modes. Plain amber fill blended into the red
              // and purple bands and was effectively invisible there.
              const offset = m.labelOffset ?? 6;
              return (
                <ReferenceLine
                  key={`evt-${i}`}
                  x={m.x}
                  stroke={color}
                  strokeWidth={1.5}
                  strokeOpacity={0.8}
                  label={(p: {
                    viewBox: { x: number; y: number; height: number };
                  }) => {
                    const cx = p.viewBox.x + 4;
                    const cy = p.viewBox.y + p.viewBox.height - offset;
                    return (
                      <text
                        x={cx}
                        y={cy}
                        transform={`rotate(-90, ${cx}, ${cy})`}
                        textAnchor="start"
                        className="fill-foreground"
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          paintOrder: "stroke",
                          stroke: "hsl(var(--background))",
                          strokeWidth: 3,
                          strokeLinejoin: "round",
                        }}
                      >
                        {m.label}
                      </text>
                    );
                  }}
                />
              );
            })}

            {showZeroLine && (
              <ReferenceLine y={0} stroke="#64748b" strokeOpacity={0.3} />
            )}

            {horizontalReferences?.map((r, i) => {
              const color = r.color ?? "#b45309";
              return (
                <ReferenceLine
                  key={`href-${i}`}
                  y={r.y}
                  stroke={color}
                  strokeDasharray={r.strokeDasharray ?? "4 4"}
                  strokeOpacity={0.85}
                  ifOverflow="extendDomain"
                  label={
                    r.label
                      ? {
                          value: r.label,
                          position: "insideTopRight",
                          fill: color,
                          fontSize: 11,
                          fontWeight: 600,
                        }
                      : undefined
                  }
                />
              );
            })}

            {/* Peer lines render BEFORE the BG lines so BG paints on top.
                Entire peer overlay (EU27 dashed reference + the four peer
                countries) is gated behind `peerCompareEnabled` — when off,
                the chart shows pure BG so a first-time reader is not
                distracted by ghost lines they did not ask for. */}
            {peerCompareEnabled
              ? flatKeys.flatMap((k) => {
                  if (!enabled[k]) return [];
                  const overlay = peerOverlay?.[k];
                  if (!overlay) return [];
                  const out: ReactElement[] = [];
                  // EU27 dashed reference.
                  if ((overlay.series.EU27_2020?.length ?? 0) > 0) {
                    const s = PEER_STROKES.EU27_2020;
                    out.push(
                      <Line
                        key={`peer-${k}-EU27_2020`}
                        type="monotone"
                        dataKey={peerDataKey(k, "EU27_2020")}
                        stroke={s.stroke}
                        strokeWidth={s.width}
                        strokeDasharray={s.dash}
                        strokeOpacity={0.85}
                        dot={false}
                        activeDot={false}
                        isAnimationActive={false}
                        connectNulls
                      />,
                    );
                  }
                  // Four peer countries.
                  for (const geo of PEER_COUNTRIES_BEYOND_EU) {
                    if ((overlay.series[geo]?.length ?? 0) === 0) continue;
                    const s = PEER_STROKES[geo];
                    out.push(
                      <Line
                        key={`peer-${k}-${geo}`}
                        type="monotone"
                        dataKey={peerDataKey(k, geo)}
                        stroke={s.stroke}
                        strokeWidth={s.width}
                        strokeDasharray={s.dash}
                        strokeOpacity={0.65}
                        dot={false}
                        activeDot={false}
                        isAnimationActive={false}
                        connectNulls
                      />,
                    );
                  }
                  return out;
                })
              : null}

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
