// /culture — the Култура dashboard. The dedicated view owns the per-recipient
// subsidy story (Phase 1: НФЦ film money — who gets it, what discipline, how it
// concentrates, how it moved over time); the МК awarder pack (/awarder/000695160)
// owns the money-as-buyer sliver, and the МК ministry page owns the budget.
//
// Dashboard shell per the house UX: no tabs, stacked sections, homepage width.
// The per-capita-by-oblast hero map (plan §5.1 tile 1) is deferred — it needs a
// producer→oblast geocode (producer EIK resolution, §6) that Phase 1 doesn't build.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { StatCard } from "@/screens/dashboard/StatCard";
import { formatEurCompact, formatInt, formatPct } from "@/lib/currency";
import { useCultureOverview, useCultureFilms } from "@/data/culture/useCulture";
import { useScope, scopeYear } from "@/data/scope/useScope";
import { ScopeControl } from "@/screens/components/ScopeControl";
import {
  CULTURE_FIRST_YEAR,
  scopeCultureOverview,
} from "@/data/culture/scopeOverview";
import { CultureCompositionTile } from "./CultureCompositionTile";
import { CultureTimeSpineTile } from "./CultureTimeSpineTile";
import { CultureConcentrationTile } from "./CultureConcentrationTile";
import { CultureFilmAwardsTile } from "./CultureFilmAwardsTile";
import { CultureScaleTile } from "./CultureScaleTile";
import { CultureMunicipalTile } from "./CultureMunicipalTile";
import { CultureCommissionsTile } from "./CultureCommissionsTile";
import { CultureGrantsTile } from "./CultureGrantsTile";
import { CultureOblastMapTile } from "./CultureOblastMapTile";
import { CultureAwardersTile } from "./CultureAwardersTile";
import { SectorBreadcrumb } from "@/screens/components/procurement/SectorBreadcrumb";

export const CultureScreen = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data, isLoading, isError } = useCultureOverview();
  // The full film corpus is a second, larger fetch — it must not gate the
  // overview-driven tiles, so the awards tile renders once it lands.
  const { data: filmsFile } = useCultureFilms();

  // Year scope (shared `?pscope` param). Default (ns) = all years; a "y:<year>"
  // pins one year and the film KPIs / discipline split / concentration / awards
  // re-aggregate to it (client-side). The time-spine stays full-history.
  const { scope } = useScope();
  const year = scopeYear(scope);
  const scoped = useMemo(
    () =>
      data ? scopeCultureOverview(data, filmsFile?.films, year) : undefined,
    [data, filmsFile, year],
  );
  const lastYear = data?.lastYear ?? new Date().getFullYear();
  const cultureYears = useMemo(
    () =>
      Array.from(
        { length: lastYear - CULTURE_FIRST_YEAR + 1 },
        (_, i) => lastYear - i,
      ),
    [lastYear],
  );

  const eur = (v: number) => formatEurCompact(v, lang);
  const spanLabel = (o: { firstYear: number; lastYear: number }) =>
    o.firstYear === o.lastYear
      ? `${o.firstYear}`
      : `${o.firstYear}–${o.lastYear}`;

  const title = bg ? "Култура" : "Culture";
  const description = bg
    ? "Къде отиват държавните пари за култура — субсидиите на Националния филмов център за игрално, документално и анимационно кино (2014–2025): кой ги получава, как се концентрират и как се менят през годините."
    : "Where Bulgaria's culture money goes — the National Film Center's subsidies for feature, documentary and animation film (2014–2025): who receives them, how they concentrate, and how they moved over time.";

  return (
    <>
      <Title description={description}>{title}</Title>
      <SectorBreadcrumb currentKey="culture_nav" />

      <ScopeControl
        className="mt-3"
        years={cultureYears}
        nsLabelOverride={bg ? "Всички години" : "All years"}
        allowAll={false}
      />

      {isLoading && (
        <div className="my-4 h-[320px] animate-pulse rounded-xl border bg-card" />
      )}

      {!isLoading && (isError || !data) && (
        <div className="my-4 rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
          {bg
            ? "Данните за културата не се заредиха. Опитай да презаредиш страницата."
            : "The culture data failed to load. Try reloading the page."}
        </div>
      )}

      {data && scoped && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {bg
              ? `Национален филмов център · ${spanLabel(scoped)}`
              : `National Film Center · ${spanLabel(scoped)}`}
          </p>

          {/* The OG hero — KPI row + discipline split, a well-proportioned card. */}
          <div className="space-y-4" data-og="culture-hero">
            {/* Headline KPIs */}
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              <StatCard
                label={bg ? "Обща субсидия" : "Total subsidy"}
                hint={
                  bg
                    ? `Държавна субсидия за кино, ${spanLabel(scoped)}.`
                    : `State film subsidy, ${spanLabel(scoped)}.`
                }
              >
                <span className="text-2xl font-bold tabular-nums">
                  {eur(scoped.totalEur)}
                </span>
              </StatCard>
              <StatCard
                label={bg ? "Финансирани проекти" : "Funded projects"}
                hint={
                  bg
                    ? "Брой филмови проекти със субсидия в регистъра."
                    : "Film projects with a subsidy in the register."
                }
              >
                <span className="text-2xl font-bold tabular-nums">
                  {formatInt(scoped.filmCount, lang)}
                </span>
              </StatCard>
              <StatCard
                label={bg ? "Продуценти" : "Producers"}
                hint={
                  bg
                    ? "Различни продуценти (групирани по име)."
                    : "Distinct producers (grouped by name)."
                }
              >
                <span className="text-2xl font-bold tabular-nums">
                  {formatInt(scoped.producerCount, lang)}
                </span>
              </StatCard>
              <StatCard
                label={bg ? "Концентрация" : "Concentration"}
                hint={
                  bg
                    ? "Дял на топ 10 продуценти от цялата субсидия."
                    : "Share of subsidy held by the top 10 producers."
                }
              >
                <span className="text-2xl font-bold tabular-nums">
                  {formatPct(scoped.top10Share, lang)}
                </span>
              </StatCard>
              <StatCard
                label={bg ? "Средна субсидия" : "Average subsidy"}
                hint={
                  bg
                    ? "Обща субсидия ÷ брой проекти."
                    : "Total subsidy ÷ number of projects."
                }
              >
                <span className="text-2xl font-bold tabular-nums">
                  {eur(
                    scoped.filmCount ? scoped.totalEur / scoped.filmCount : 0,
                  )}
                </span>
              </StatCard>
            </div>

            {/* Where the money goes, by discipline */}
            <CultureCompositionTile
              byDiscipline={scoped.byDiscipline}
              totalEur={scoped.totalEur}
            />

            {/* How it moved over time — a historical trend, always full-history
                (never scoped to the selected year). */}
            <CultureTimeSpineTile byYear={data.byYear} />
          </div>

          {/* Scale — film subsidies in proportion to the bigger culture streams */}
          <CultureScaleTile />

          {/* Municipal + читалища — the two streams the scale tile only shows as
              single lines, broken out (Sofia per-направление + читалища national) */}
          <CultureMunicipalTile />

          {/* Who wins (concentration) + the biggest single awards — paired
              side by side on desktop, stacked on mobile. */}
          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <CultureConcentrationTile
              topProducers={scoped.topProducers}
              top10Share={scoped.top10Share}
            />
            {filmsFile && (
              <CultureFilmAwardsTile
                films={
                  year
                    ? filmsFile.films.filter((f) => f.year === year)
                    : filmsFile.films
                }
              />
            )}
          </div>

          {/* Who decides — the artistic-commission compositions (кой решава) */}
          <CultureCommissionsTile />

          {/* НФК grants — the success rate (applied vs funded) per discipline */}
          <CultureGrantsTile />

          {/* Regional facet — the state cultural institutes on the map (reliable
              EIK geography), distinct from the film-subsidy story above. */}
          <CultureOblastMapTile />

          {/* Culture bodies as public buyers — bridge to the awarder pages */}
          <CultureAwardersTile />

          <p className="text-[11px] text-muted-foreground/80">
            {bg
              ? "Данните са от Единния публичен регистър на финансираните филми и сериали на Националния филмов център (2014–2025). Сумите са държавна субсидия в лева, конвертирани в евро по фиксирания курс 1 EUR = 1,95583 лв. Средствата се предоставят чрез художествените комисии на НФЦ, извън Закона за обществените поръчки."
              : "Data from the National Film Center's public register of financed films and series (2014–2025). Amounts are state subsidy in leva, converted to euro at the fixed rate 1 EUR = 1.95583 BGN. Funds are awarded via the НФЦ artistic commissions, outside the Public Procurement Act."}{" "}
            <a
              href={data.source.url}
              target="_blank"
              rel="noreferrer"
              className="hover:text-primary hover:underline"
            >
              {bg ? "Източник: НФЦ" : "Source: НФЦ"}
            </a>
          </p>
        </div>
      )}
    </>
  );
};
