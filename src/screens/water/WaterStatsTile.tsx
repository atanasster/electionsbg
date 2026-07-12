// "Воден режим и достъп до вода" — the NSI national water-services series: the
// share of the population under water rationing (воден режим) over time, plus
// connection to public water supply and wastewater treatment. National, whole-
// history (not scoped by ?pscope). From data/water/water_stats.json (НСИ). The
// by-year rationing bars are OVERLAID BY GOVERNMENT — each bar coloured by the
// cabinet in power that year (party colour; caretakers grey) with a hover
// tooltip. See docs/plans/water-view-v1.md §3 (Tier B).

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Droplet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useWaterStats } from "@/data/water/useWaterStats";
import {
  useGovernments,
  type Government,
} from "@/data/governments/useGovernments";
import { cabinetShortLabel } from "@/data/governments/cabinetLabel";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";

const CARETAKER_COLOR = "#9ca3af";
const NO_GOV_COLOR = "var(--muted-foreground)";

export const WaterStatsTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const bg = lang === "bg";
  const { data, isLoading } = useWaterStats();
  const { data: govData } = useGovernments();
  const { colorFor } = useCanonicalParties();
  const [hover, setHover] = useState<number | null>(null);

  const governments = useMemo(() => govData ?? [], [govData]);

  // The cabinet in power at mid-year (Jul 1) — a single reference date resolves
  // transition years to one cabinet without splitting the bar. YYYY-MM-DD strings
  // compare lexically.
  const cabinetForYear = (year: number): Government | null => {
    const ref = `${year}-07-01`;
    return (
      governments.find(
        (g) => g.startDate <= ref && (g.endDate == null || g.endDate >= ref),
      ) ?? null
    );
  };
  const cabColor = (g: Government | null): string => {
    if (!g) return NO_GOV_COLOR;
    if (g.type === "caretaker" || !g.parties?.length) return CARETAKER_COLOR;
    const p = g.parties[0];
    return colorFor(p) ?? colorFor(p.split(/[-–/]/)[0].trim()) ?? "#0ea5e9";
  };
  const cabLabel = (g: Government | null): string =>
    !g
      ? "—"
      : g.type === "caretaker"
        ? `${cabinetShortLabel(g, governments, lang)} · ${bg ? "служебен" : "caretaker"}`
        : `${cabinetShortLabel(g, governments, lang)} (${(bg ? g.parties : g.partiesEn).join(", ")})`;

  if (isLoading)
    return (
      <div className="h-[280px] animate-pulse rounded-xl border bg-card" />
    );
  if (!data || !data.years.length) return null;

  const years = data.years;
  const latest = years[years.length - 1];
  const max = Math.max(...years.map((y) => y.rationingPct ?? 0), 1);
  const pct = (v: number | null): string =>
    v == null
      ? "—"
      : `${v.toLocaleString(lang, { maximumFractionDigits: 1 })}%`;
  const hoveredYear = hover != null ? years[hover] : null;

  return (
    <Card id="water-stats">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Droplet className="h-4 w-4" />
          {bg
            ? "Воден режим и достъп до вода (НСИ)"
            : "Water rationing & access (NSI)"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <div
              className={`text-xl font-bold tabular-nums ${(latest.rationingPct ?? 0) >= 4 ? "text-amber-600 dark:text-amber-400" : ""}`}
            >
              {pct(latest.rationingPct)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {bg
                ? `на воден режим (${latest.year})`
                : `under rationing (${latest.year})`}
            </div>
          </div>
          <div>
            <div className="text-xl font-bold tabular-nums">
              {pct(latest.connectedWaterPct)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {bg ? "с водоснабдяване" : "with water supply"}
            </div>
          </div>
          <div>
            <div className="text-xl font-bold tabular-nums">
              {pct(latest.wasteTreatmentPct)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {bg ? "с пречистване" : "with treatment"}
            </div>
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {bg
                ? "Население на воден режим, по години"
                : "Population under water rationing, by year"}
            </span>
            <span className="text-[10px] text-muted-foreground/70">
              {bg ? "цвят = управляващ кабинет" : "colour = ruling cabinet"}
            </span>
          </div>

          {/* Bars: height = rationing %, colour = the cabinet in power that year. */}
          <div className="relative">
            {hoveredYear && (
              <div
                className="pointer-events-none absolute -top-1 z-10 w-max max-w-[240px] -translate-x-1/2 -translate-y-full rounded-md border bg-popover px-2.5 py-1.5 text-[11px] shadow-md"
                style={{
                  left: `${((hover! + 0.5) / years.length) * 100}%`,
                }}
              >
                <div className="font-semibold">
                  {hoveredYear.year}: {pct(hoveredYear.rationingPct)}{" "}
                  {bg ? "на режим" : "under rationing"}
                </div>
                <div className="text-muted-foreground">
                  {bg ? "сезонен" : "seasonal"}{" "}
                  {pct(hoveredYear.rationingSeasonalPct)} ·{" "}
                  {bg ? "целогодишен" : "year-round"}{" "}
                  {pct(hoveredYear.rationingYearRoundPct)}
                </div>
                <div className="mt-0.5 flex items-center gap-1">
                  <span
                    className="inline-block h-2 w-2 rounded-sm"
                    style={{
                      backgroundColor: cabColor(
                        cabinetForYear(hoveredYear.year),
                      ),
                    }}
                  />
                  {cabLabel(cabinetForYear(hoveredYear.year))}
                </div>
              </div>
            )}
            <div className="flex items-end gap-0.5" style={{ height: 56 }}>
              {years.map((y, i) => {
                const v = y.rationingPct ?? 0;
                return (
                  <div
                    key={y.year}
                    className="flex h-full flex-1 cursor-default items-end"
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                  >
                    <div
                      className={`w-full rounded-sm transition-opacity ${hover != null && hover !== i ? "opacity-45" : ""}`}
                      style={{
                        height: Math.max(2, (v / max) * 56),
                        backgroundColor: cabColor(cabinetForYear(y.year)),
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground/70">
            <span>{years[0].year}</span>
            <span>{latest.year}</span>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `Дял от населението на режим на водоснабдяване, свързано с обществено водоснабдяване и с пречистване на отпадъчни води (НСИ, „Статистика на водите"). Стълбовете са оцветени по управляващия кабинет през съответната година. През ${latest.year} г. ${pct(latest.rationingPct)} от населението е било на режим — предимно сезонен (${pct(latest.rationingSeasonalPct)}).`
            : `Share of the population under water rationing, connected to public water supply, and connected to wastewater treatment (NSI water statistics). Bars are coloured by the cabinet in power that year. In ${latest.year}, ${pct(latest.rationingPct)} were under rationing — mostly seasonal (${pct(latest.rationingSeasonalPct)}).`}
        </p>
      </CardContent>
    </Card>
  );
};
