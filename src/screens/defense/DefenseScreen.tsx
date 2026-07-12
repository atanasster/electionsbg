// /defense — the Отбрана (national defence) dashboard.
//
// The money half of the defence story lives on the МО awarder page (the
// DefensePack: 25-unit group procurement, contractor HHI, single-bid competition,
// the transparency gap). This screen is the half the procurement corpus can't
// tell: the %GDP path to 5%, the equipment-vs-personnel crossover, the flagship
// FMS programs (F-16, Stryker), the arms-export boom and force readiness — from
// NATO, the Ministry of Economy and the МО's own reports.
//
// Dashboard shell (no tabs, stacked sections, homepage width) per the house UX.
// Charts are historical time-spines (never scoped); the KPI row re-anchors to a
// picked year (culture/education pattern) — see docs/plans/defense-pack-v1.md §12.

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarRange } from "lucide-react";
import { Title } from "@/ux/Title";
import { StatCard } from "@/screens/dashboard/StatCard";
import { formatEurCompact } from "@/lib/currency";
import type { ProcurementScope } from "@/data/procurement/useProcurementScope";
import { ProcurementScopeControl } from "@/screens/components/procurement/ProcurementScopeControl";
import { ProcurementThematicNav } from "@/screens/components/procurement/ProcurementThematicNav";
import {
  useDefenseGdpShare,
  useDefenseCategorySplit,
  useDefenseExports,
  useDefensePrograms,
  useDefenseReadiness,
  useDefensePeers,
} from "@/data/defense/useDefenseData";
import { DefenseGdpTile } from "./DefenseGdpTile";
import { DefensePeerTile } from "./DefensePeerTile";
import { DefenseCategorySplitTile } from "./DefenseCategorySplitTile";
import { DefenseProgramsTile } from "./DefenseProgramsTile";
import { DefenseSustainmentTile } from "./DefenseSustainmentTile";
import { DefenseExportsTile } from "./DefenseExportsTile";
import { DefenseReadinessTile } from "./DefenseReadinessTile";
import { DefenseAwardersTile } from "./DefenseAwardersTile";

export const DefenseScreen = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";

  const gdp = useDefenseGdpShare();
  const split = useDefenseCategorySplit();
  const exports = useDefenseExports();
  const programs = useDefensePrograms();
  const readiness = useDefenseReadiness();
  const peers = useDefensePeers();

  const isLoading = gdp.isLoading;
  const isError = gdp.isError;

  // Year picker re-anchors the KPI row (the charts below stay full-history). Years
  // come from the %GDP series (the widest span); default = latest.
  const years = useMemo(
    () => (gdp.data ? gdp.data.series.map((p) => p.year) : []),
    [gdp.data],
  );
  const latestYear = years.length ? years[years.length - 1] : null;
  const [yearOverride, setYearOverride] = useState<number | null>(null);
  const selectedYear = yearOverride ?? latestYear;

  const scopeValue: ProcurementScope =
    yearOverride != null ? `y:${yearOverride}` : "ns";
  const onScopeChange = (next: ProcurementScope) => {
    if (next === "ns" || next === "all") setYearOverride(null);
    else setYearOverride(Number(next.slice(2)));
  };

  // Each series has a different span (gdp 2014–, split 2019–, exports 2021–2024).
  // Show the picked year if present, else fall back to the series' own latest so
  // the default "latest year" view is never blank — annotate when it's a fallback.
  const pick = <T extends { year: number }>(rows: T[] | undefined) => {
    if (!rows?.length || selectedYear == null) return undefined;
    const exact = rows.find((r) => r.year === selectedYear);
    if (exact) return exact;
    const latest = rows[rows.length - 1];
    return latest && latest.year < selectedYear ? latest : undefined;
  };
  const yearSuffix = (pt: { year: number } | undefined) =>
    pt && pt.year !== selectedYear ? ` ’${String(pt.year).slice(2)}` : "";
  const gdpPt = pick(gdp.data?.series);
  const splitPt = pick(split.data?.series);
  const exportPt = pick(exports.data?.series);
  // Per-capita is a raw array aligned to peers.years — lift it to {year, usd}
  // rows so it re-anchors to the picked year like the other KPIs.
  const perCapitaPt = pick(
    peers.data?.bulgaria?.perCapitaUsd.map((usd, i) => ({
      year: peers.data!.years[i],
      usd,
    })),
  );
  const dash = "—";

  const title = bg ? "Отбрана" : "Defense";
  const description = bg
    ? "Разходите на България за отбрана: пътят към 5% от БВП, техника срещу заплати, големите програми (F-16, Stryker), рекордният износ на оръжие и готовността на армията — по данни на НАТО, Министерството на икономиката и МО."
    : "Bulgaria's defence spending: the road to 5% of GDP, equipment vs personnel, the flagship programs (F-16, Stryker), the record arms exports and force readiness — from NATO, the Ministry of Economy and the МО.";

  return (
    <>
      <Title description={description}>{title}</Title>
      <ProcurementThematicNav />

      {isLoading && (
        <div className="my-4 h-[320px] animate-pulse rounded-xl border bg-card" />
      )}

      {!isLoading && (isError || !gdp.data) && (
        <div className="my-4 rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
          {bg
            ? "Данните за отбраната не се заредиха. Опитай да презаредиш страницата."
            : "The defence data failed to load. Try reloading the page."}
        </div>
      )}

      {gdp.data && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <CalendarRange className="h-3.5 w-3.5" />
              {bg ? "Показатели за година" : "Metrics for year"}
            </span>
            <ProcurementScopeControl
              value={scopeValue}
              onChange={onScopeChange}
              years={years}
              allowAll={false}
              nsLabelOverride={bg ? "Последна година" : "Latest year"}
            />
          </div>

          {/* KPI row — re-anchored to the picked year */}
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <StatCard
              label={bg ? "Дял от БВП" : "Share of GDP"}
              hint={
                bg
                  ? `Разходи за отбрана като дял от БВП, ${selectedYear} г. (НАТО).`
                  : `Defence spending as a share of GDP, ${selectedYear} (NATO).`
              }
            >
              <span className="text-2xl font-bold tabular-nums">
                {gdpPt ? `${gdpPt.pct}%` : dash}
                <span className="text-xs font-normal text-muted-foreground">
                  {yearSuffix(gdpPt)}
                </span>
              </span>
            </StatCard>
            <StatCard
              label={bg ? "Дял за техника" : "Equipment share"}
              hint={
                bg
                  ? `Дял на разхода за въоръжение и НИРД, ${selectedYear} г. Насока на НАТО: 20%.`
                  : `Share of spend on equipment & R&D, ${selectedYear}. NATO guideline: 20%.`
              }
            >
              <span className="text-2xl font-bold tabular-nums">
                {splitPt ? `${Math.round(splitPt.equipment)}%` : dash}
                <span className="text-xs font-normal text-muted-foreground">
                  {yearSuffix(splitPt)}
                </span>
              </span>
            </StatCard>
            <StatCard
              label={bg ? "Износ на оръжие" : "Arms exports"}
              hint={
                bg
                  ? `Износ на отбранителна продукция, ${selectedYear} г. (Министерство на икономиката).`
                  : `Defence-product exports, ${selectedYear} (Ministry of Economy).`
              }
            >
              <span className="text-2xl font-bold tabular-nums">
                {exportPt ? formatEurCompact(exportPt.totalEur, lang) : dash}
                <span className="text-xs font-normal text-muted-foreground">
                  {yearSuffix(exportPt)}
                </span>
              </span>
            </StatCard>
            <StatCard
              label={bg ? "Незаети бройки" : "Personnel vacancy"}
              hint={
                bg
                  ? "Дял на незаетите щатни бройки (последни данни)."
                  : "Share of unfilled established posts (latest)."
              }
            >
              <span className="text-2xl font-bold tabular-nums">
                {readiness.data
                  ? `${readiness.data.personnelVacancyPct}%`
                  : dash}
              </span>
            </StatCard>
            <StatCard
              label={bg ? "На човек" : "Per capita"}
              hint={
                bg
                  ? "Разход за отбрана на глава от населението (щатски долари, НАТО)."
                  : "Defence spending per head of population (US dollars, NATO)."
              }
            >
              <span className="text-2xl font-bold tabular-nums">
                {perCapitaPt ? `$${perCapitaPt.usd}` : dash}
                <span className="text-xs font-normal text-muted-foreground">
                  {yearSuffix(perCapitaPt)}
                </span>
              </span>
            </StatCard>
          </div>

          {/* Hero — the %GDP path to 5% */}
          <DefenseGdpTile data={gdp.data} />

          {/* Is 2% a lot? — the peer comparator that makes the rate legible */}
          {peers.data && <DefensePeerTile data={peers.data} />}

          {/* The equipment-vs-personnel crossover */}
          {split.data && <DefenseCategorySplitTile data={split.data} />}

          {/* The flagship programs the corpus can't show */}
          {programs.data && <DefenseProgramsTile data={programs.data} />}

          {/* The signature counterweight — what the corpus DOES show: sustaining
              the ageing fleet (acquisition invisible, sustainment visible). */}
          <DefenseSustainmentTile />

          {/* The arms-export boom */}
          {exports.data && <DefenseExportsTile data={exports.data} />}

          {/* People & readiness */}
          {readiness.data && <DefenseReadinessTile data={readiness.data} />}

          {/* Bridge to the money half */}
          <DefenseAwardersTile />

          <p className="text-[11px] text-muted-foreground/80">
            {bg
              ? "Източници: НАТО (Defence Expenditure of NATO Countries), Евростат COFOG, Министерство на икономиката (износ), Министерство на отбраната (доклад за състоянието на отбраната). Числата за F-16/Stryker са по публични ратификационни закони и съобщения."
              : "Sources: NATO (Defence Expenditure of NATO Countries), Eurostat COFOG, Ministry of Economy (exports), Ministry of Defence (state-of-defence report). F-16/Stryker figures are from public ratification laws and statements."}
          </p>
        </div>
      )}
    </>
  );
};
