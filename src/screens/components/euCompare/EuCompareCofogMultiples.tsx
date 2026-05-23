// Side-by-side COFOG (functional-classification) stacked bars for the EU
// compare dashboard. One vertical bar per visible geo, segmented into the
// ten top-level COFOG functions. Bar total height = sum of all functions
// (general-government expenditure as % of GDP), so countries that spend
// more overall stand taller; the segment slices show *what* they spend on.
//
// Below the chart we surface the three largest BG-vs-EU27 deltas as
// inline sentences — that's the editorial value-add nobody else ships and
// the reason this dashboard exists at all.
//
// Hand-rolled SVG rather than Recharts BarChart: 6 bars × 10 stacks is
// small, the styling we want (segment hover, EU27 reference dashed line,
// labelled gaps) is awkward in Recharts, and skipping the wrapper saves
// a meaningful chunk of layout JS for this tile.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  COFOG_FUNCTIONS,
  useCofog,
  type CofogCode,
} from "@/data/macro/useCofog";
import { cn } from "@/lib/utils";
import {
  GEO_SHORT_BG,
  GEO_SHORT_EN,
  usePeerSelection,
} from "./usePeerSelection";
import { useElectionYear } from "./useElectionYear";
import { COFOG_FUNCTION_COLOR, COFOG_STACK_ORDER } from "./cofogPalette";

type FunctionCode = Exclude<CofogCode, "TOTAL">;

const sumPct = (
  composition: Partial<Record<FunctionCode, number>> | undefined,
): number => {
  if (!composition) return 0;
  return COFOG_FUNCTIONS.reduce(
    (acc, f) => acc + (composition[f as FunctionCode] ?? 0),
    0,
  );
};

export const EuCompareCofogMultiples: FC = () => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { data: cofog } = useCofog();
  const { geos } = usePeerSelection();
  const electionYear = useElectionYear();
  const shortLabel = lang === "bg" ? GEO_SHORT_BG : GEO_SHORT_EN;

  // Pick the COFOG composition year closest to (≤) the selected election.
  // Eurostat sometimes leaves a peer (notably GR) blank for the most
  // recent year — we render the gap explicitly rather than skipping the
  // slot, so the chart layout stays stable as the user toggles peers.
  const peerSeriesByYear = useMemo(
    () => cofog?.peerSeriesByYear ?? {},
    [cofog],
  );
  const year = useMemo(() => {
    const years = Object.keys(peerSeriesByYear)
      .map((y) => Number(y))
      .filter((y) => Number.isFinite(y))
      .sort((a, b) => a - b);
    if (years.length === 0) return undefined;
    for (let i = years.length - 1; i >= 0; i--) {
      if (years[i] <= electionYear) return years[i];
    }
    return years[0];
  }, [peerSeriesByYear, electionYear]);
  const peerSeries = useMemo(
    () => (year != null ? (peerSeriesByYear[String(year)] ?? {}) : {}),
    [peerSeriesByYear, year],
  );

  // Compute biggest BG-vs-EU27 deltas. Negative = BG spends less than EU.
  const deltas = useMemo(() => {
    const bg = peerSeries["BG"];
    const eu = peerSeries["EU27_2020"];
    if (!bg || !eu) return [];
    const entries: {
      code: FunctionCode;
      deltaPp: number;
      bg: number;
      eu: number;
    }[] = [];
    for (const code of COFOG_FUNCTIONS) {
      const bgV = bg[code as FunctionCode];
      const euV = eu[code as FunctionCode];
      if (bgV == null || euV == null) continue;
      entries.push({
        code: code as FunctionCode,
        deltaPp: bgV - euV,
        bg: bgV,
        eu: euV,
      });
    }
    return entries
      .sort((a, b) => Math.abs(b.deltaPp) - Math.abs(a.deltaPp))
      .slice(0, 3);
  }, [peerSeries]);

  if (!cofog || !year || Object.keys(peerSeries).length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("gov_macro_unavailable")}
      </p>
    );
  }

  // Y-axis: use the largest bar total + a bit of headroom as the domain.
  // This keeps all bars proportional so the per-country totals stay
  // comparable.
  const totals = geos.map((g) => sumPct(peerSeries[g]));
  const maxTotal = Math.max(...totals, 40);
  const yMax = Math.ceil(maxTotal / 5) * 5 + 5; // round up to nearest 5pp

  // SVG geometry — width adapts to the parent via viewBox; we pick fixed
  // logical units so each bar gets the same slot regardless of how many
  // geos are visible.
  const barSlot = 80;
  const barWidth = 44;
  const chartH = 260;
  const padTop = 12;
  const padBottom = 28;
  const plotH = chartH - padTop - padBottom;
  const chartW = barSlot * geos.length;

  const yFor = (pct: number): number => padTop + (plotH * (yMax - pct)) / yMax;

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${chartW} ${chartH}`}
          width="100%"
          height={chartH}
          role="img"
          aria-label={t("eu_compare_section_cofog_title")}
          style={{ minWidth: chartW }}
        >
          {/* y-axis ticks (every 10pp) */}
          {Array.from(
            { length: Math.floor(yMax / 10) + 1 },
            (_, i) => i * 10,
          ).map((tick) => (
            <g key={`y-${tick}`}>
              <line
                x1={0}
                x2={chartW}
                y1={yFor(tick)}
                y2={yFor(tick)}
                stroke="hsl(var(--border))"
                strokeDasharray={tick === 0 ? undefined : "2 3"}
                strokeWidth={tick === 0 ? 1 : 0.5}
              />
              <text
                x={2}
                y={yFor(tick) - 2}
                fontSize={9}
                fill="hsl(var(--muted-foreground))"
              >
                {tick}%
              </text>
            </g>
          ))}
          {/* per-geo stacks */}
          {geos.map((g, gi) => {
            const composition = peerSeries[g];
            const xCenter = gi * barSlot + barSlot / 2;
            const x = xCenter - barWidth / 2;
            const total = sumPct(composition);
            if (!composition || total === 0) {
              return (
                <g key={g}>
                  <text
                    x={xCenter}
                    y={chartH - 10}
                    textAnchor="middle"
                    fontSize={11}
                    fill="hsl(var(--muted-foreground))"
                  >
                    {shortLabel[g]}
                  </text>
                  <text
                    x={xCenter}
                    y={padTop + plotH / 2}
                    textAnchor="middle"
                    fontSize={11}
                    fill="hsl(var(--muted-foreground))"
                  >
                    —
                  </text>
                </g>
              );
            }
            // Walk the stack from bottom up so the first-drawn slice sits
            // on the baseline. COFOG_STACK_ORDER is bottom→top in our
            // visual model, so we reverse to draw correctly.
            let cursorPct = 0;
            const segs = [...COFOG_STACK_ORDER].reverse().map((code) => {
              const v = composition[code as FunctionCode] ?? 0;
              const yTop = yFor(cursorPct + v);
              const yBot = yFor(cursorPct);
              cursorPct += v;
              return { code, v, yTop, yBot };
            });
            return (
              <g key={g}>
                {segs.map(({ code, v, yTop, yBot }) =>
                  v <= 0 ? null : (
                    <rect
                      key={code}
                      x={x}
                      y={yTop}
                      width={barWidth}
                      height={Math.max(yBot - yTop, 0.5)}
                      fill={COFOG_FUNCTION_COLOR[code as FunctionCode]}
                      stroke="hsl(var(--background))"
                      strokeWidth={0.5}
                    >
                      <title>{`${t(`cofog_${code}`)} · ${v.toFixed(1)}%`}</title>
                    </rect>
                  ),
                )}
                <text
                  x={xCenter}
                  y={yFor(total) - 4}
                  textAnchor="middle"
                  fontSize={10}
                  fill="hsl(var(--foreground))"
                  fontWeight={g === "BG" ? 600 : 400}
                >
                  {total.toFixed(1)}%
                </text>
                <text
                  x={xCenter}
                  y={chartH - 10}
                  textAnchor="middle"
                  fontSize={11}
                  fill={
                    g === "BG"
                      ? "hsl(var(--foreground))"
                      : "hsl(var(--muted-foreground))"
                  }
                  fontWeight={g === "BG" ? 600 : 400}
                >
                  {shortLabel[g]}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Function-color legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        {[...COFOG_STACK_ORDER].reverse().map((code) => (
          <span key={code} className="inline-flex items-center gap-1">
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-sm"
              style={{ background: COFOG_FUNCTION_COLOR[code as FunctionCode] }}
            />
            <span className="text-muted-foreground">{t(`cofog_${code}`)}</span>
          </span>
        ))}
      </div>

      {/* Annotated BG-vs-EU27 deltas — the editorial value-add */}
      {deltas.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {deltas.map((d) => {
            const sign = d.deltaPp > 0 ? "more" : "less";
            const key =
              sign === "less"
                ? "eu_compare_cofog_delta_less"
                : "eu_compare_cofog_delta_more";
            return (
              <li key={d.code}>
                {t(key, {
                  function: t(`cofog_${d.code}`),
                  pp: Math.abs(d.deltaPp).toFixed(1),
                  bg: d.bg.toFixed(1),
                  eu: d.eu.toFixed(1),
                })}
              </li>
            );
          })}
        </ul>
      )}

      <p
        className={cn(
          "text-[10px] text-muted-foreground/70",
          deltas.length === 0 ? "mt-0" : "",
        )}
      >
        {t("eu_compare_cofog_footnote", { year })}
      </p>
    </div>
  );
};
