// "Воден режим и достъп до вода" — the NSI national water-services series: the
// share of the population under water rationing (воден режим) over time, plus
// connection to public water supply and wastewater treatment. National, whole-
// history (not scoped by ?pscope). From data/water/water_stats.json (НСИ). See
// docs/plans/water-view-v1.md §3 (Tier B).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Droplet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useWaterStats } from "@/data/water/useWaterStats";

export const WaterStatsTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data, isLoading } = useWaterStats();

  if (isLoading)
    return (
      <div className="h-[260px] animate-pulse rounded-xl border bg-card" />
    );
  if (!data || !data.years.length) return null;

  const years = data.years;
  const latest = years[years.length - 1];
  const rationing = years.map((y) => y.rationingPct ?? 0);
  const max = Math.max(...rationing, 1);
  const pct = (v: number | null): string =>
    v == null
      ? "—"
      : `${v.toLocaleString(lang, { maximumFractionDigits: 1 })}%`;

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
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            {bg
              ? "Население на воден режим, по години"
              : "Population under water rationing, by year"}
          </div>
          <div className="flex items-end gap-0.5" style={{ height: 56 }}>
            {years.map((y) => {
              const v = y.rationingPct ?? 0;
              return (
                <div
                  key={y.year}
                  className="group relative flex-1"
                  title={`${y.year}: ${pct(y.rationingPct)}`}
                >
                  <div
                    className={`w-full rounded-sm ${v >= 4 ? "bg-amber-500" : "bg-sky-500/70"}`}
                    style={{ height: Math.max(2, (v / max) * 56) }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground/70">
            <span>{years[0].year}</span>
            <span>{latest.year}</span>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `Дял от населението на режим на водоснабдяване, свързано с обществено водоснабдяване и с пречистване на отпадъчни води (НСИ, „Статистика на водите"). През ${latest.year} г. ${pct(latest.rationingPct)} от населението е било на режим — предимно сезонен (${pct(latest.rationingSeasonalPct)}).`
            : `Share of the population under water rationing, connected to public water supply, and connected to wastewater treatment (NSI water statistics). In ${latest.year}, ${pct(latest.rationingPct)} were under rationing — mostly seasonal (${pct(latest.rationingSeasonalPct)}).`}
        </p>
      </CardContent>
    </Card>
  );
};
