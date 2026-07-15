// The spend↔outcome bridge on /sector/tourism: the Ministry's marketing spend
// per year (real procurement €) overlaid on foreign overnight-nights per year
// (real Eurostat) — the fusion the competitive research flagged as the thing
// almost no tourism dashboard does. DESCRIPTIVE, not causal: it shows the two
// trends side by side (e.g. the 2020 COVID collapse in nights, the 2024 spend
// spike), it does NOT claim the spend produced the nights.
//
// Full-history (NOT ?pscope-scoped) — a multi-year trend, like the culture
// time-spine. Built the same way as the seasonality tile: a FIXED-height
// container with HTML spend bars + an SVG line overlay (non-scaling stroke) +
// HTML year labels — so it's fixed-height and fluid-width like every other chart
// on the page (a viewBox + h-auto SVG would scale its height with the tile width
// and tower over the others on a wide screen).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatCompact } from "@/lib/currency";
import { useAwarderContracts } from "@/data/procurement/useAwarderContracts";
import { useTourismVisitors } from "@/data/tourism/useTourismVisitors";
import { TOURISM_MINISTRY_EIK } from "@/lib/tourismReferenceData";

const CHART_H = 170; // px — in the family of seasonality (150) / spend-by-year (220)

export const TourismSpendVsNightsTile: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const locale = bg ? "bg-BG" : "en-US";
  const { data: contracts, isLoading: cLoading } =
    useAwarderContracts(TOURISM_MINISTRY_EIK);
  const { data: visitors, isLoading: vLoading } = useTourismVisitors();

  if (cLoading || vLoading)
    return (
      <div className="h-[240px] animate-pulse rounded-xl border bg-card" />
    );
  if (!visitors || !contracts) return null;

  // Marketing € per calendar year (contracts only, to match the headline).
  const spendByYear = new Map<number, number>();
  for (const c of contracts.contracts) {
    if (c.tag !== "contract") continue;
    const y = Number((c.date ?? "").slice(0, 4));
    if (!y) continue;
    spendByYear.set(y, (spendByYear.get(y) ?? 0) + (c.amountEur ?? 0));
  }

  const rows = visitors.annualForeign.map((a) => ({
    year: a.year,
    nights: a.nights,
    spend: spendByYear.get(a.year) ?? 0,
  }));
  if (rows.length < 3) return null;

  const maxSpend = Math.max(...rows.map((r) => r.spend), 1);
  const maxNights = Math.max(...rows.map((r) => r.nights), 1);

  // Line vertices in a 0–100 box (top-based y); the SVG stretches to fill the
  // fixed-height container, the stroke stays crisp via non-scaling-stroke.
  const pts = rows.map((r, i) => ({
    year: r.year,
    x: ((i + 0.5) / rows.length) * 100,
    y: 100 - (r.nights / maxNights) * 100,
  }));
  const polyline = pts
    .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ");

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {bg ? "Реклама и чужди нощувки" : "Marketing spend vs foreign nights"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {bg
            ? "Годишен маркетингов разход (ЗОП) и чуждестранни нощувки. Съпоставка на тенденции — без причинно-следствена връзка."
            : "Yearly marketing spend (procurement) and foreign nights. Trends side by side — not a causal claim."}
        </p>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div className="relative" style={{ height: CHART_H }}>
          {/* spend bars (HTML) */}
          <div className="absolute inset-0 flex items-end gap-1.5">
            {rows.map((r) => (
              <div
                key={r.year}
                className="flex flex-1 items-end justify-center"
                title={`${r.year}: ${formatCompact(r.spend, locale)} € · ${formatCompact(r.nights, locale)} ${bg ? "нощувки" : "nights"}`}
              >
                <div
                  className="w-full max-w-[40px] rounded-t bg-primary/70"
                  style={{
                    // px, not %, so the bar has a definite height — a percentage
                    // height resolves against the auto-height flex item and
                    // collapses to 0 (the line/dots position against the fixed
                    // container so they're unaffected).
                    height: `${Math.max(2, (r.spend / maxSpend) * (CHART_H - 8))}px`,
                  }}
                />
              </div>
            ))}
          </div>
          {/* foreign-nights line overlay (SVG, crisp stroke) */}
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polyline
              points={polyline}
              fill="none"
              style={{ stroke: "hsl(var(--foreground))" }}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              opacity={0.85}
            />
          </svg>
          {/* nights vertices (HTML → stay round regardless of stretch) */}
          {pts.map((p, i) => (
            <span
              key={p.year}
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/85"
              style={{
                left: `${p.x}%`,
                top: `${p.y}%`,
                width: i === pts.length - 1 ? 7 : 5,
                height: i === pts.length - 1 ? 7 : 5,
              }}
            />
          ))}
        </div>
        {/* year labels (HTML, aligned to the bar slots) */}
        <div className="mt-1 flex gap-1.5">
          {rows.map((r) => (
            <div
              key={r.year}
              className="flex-1 text-center text-[10px] tabular-nums text-muted-foreground"
            >
              {String(r.year).slice(2)}
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-3 rounded-sm bg-primary/70" />
            {bg ? "разход за реклама (€)" : "marketing spend (€)"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-[2px] w-4 bg-foreground/85" />
            {bg ? "чужди нощувки" : "foreign nights"}
          </span>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {bg
            ? "Източник: ЗОП (data.egov.bg) · Евростат tour_occ_nim."
            : "Sources: procurement (data.egov.bg) · Eurostat tour_occ_nim."}
        </p>
      </CardContent>
    </Card>
  );
};
