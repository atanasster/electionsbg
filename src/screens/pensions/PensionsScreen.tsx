// /pensions — Пенсии. Bulgaria's pension system as a top-level view, not a
// procurement subpage. Pillar 1 (НОИ / ДОО) first: who pays for pensions, how
// they are distributed (the shape the average hides), the geography of average
// pension and of cash-collected payment, and the long wage/income/pension
// series. The procurement pack at /awarder/121082521 stays as-is and cross-links
// here.
//
// Dashboard shell (no tabs, stacked sections, homepage width) per house UX.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PiggyBank } from "lucide-react";
import { Title } from "@/ux/Title";
import { StatCard } from "@/screens/dashboard/StatCard";
import { formatEurCompact, formatInt } from "@/lib/currency";
import { useNoiPensions } from "@/data/budget/useBudget";
import { useNoiFundYear } from "@/data/procurement/useNoi";
import { PensionFundingTile } from "./PensionFundingTile";
import { PensionDistributionTile } from "./PensionDistributionTile";
import { PensionLongSeriesTile } from "./PensionLongSeriesTile";
import { PensionOblastMapTile } from "./PensionOblastMapTile";
import { PensionCashMapTile } from "./PensionCashMapTile";
import { KfnFundsTile } from "./KfnFundsTile";
import { PensionReformTile } from "./PensionReformTile";
import { PensionReplacementTile } from "./PensionReplacementTile";
import { PensionProjectionTile } from "./PensionProjectionTile";

export const PensionsScreen = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";

  const { data, isLoading, isError } = useNoiPensions();
  const { fundYear } = useNoiFundYear();

  const latestDist = useMemo(
    () =>
      data
        ? (data.distribution.find((d) => d.year === data.latestYear) ??
          data.distribution[data.distribution.length - 1] ??
          null)
        : null,
    [data],
  );
  const latestNational = useMemo(
    () =>
      data
        ? (data.national.find((n) => n.year === data.latestYear) ??
          data.national[data.national.length - 1] ??
          null)
        : null,
    [data],
  );

  const title = bg ? "Пенсии" : "Pensions";
  const description = bg
    ? "Пенсионната система на България: кой плаща пенсиите, как са разпределени, средна пенсия и плащания в брой по области, и дългосрочната връзка между заплати, осигурителен доход и пенсии."
    : "Bulgaria's pension system: who pays for pensions, how they are distributed, average pension and cash payment by oblast, and the long-run link between wages, insurable income and pensions.";

  return (
    <>
      <Title description={description}>{title}</Title>

      {isLoading && (
        <div className="my-4 h-[320px] animate-pulse rounded-xl border bg-card" />
      )}

      {!isLoading && (isError || !data) && (
        <div className="my-4 rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
          {bg
            ? "Данните за пенсиите не се заредиха. Опитай да презаредиш страницата."
            : "The pension data failed to load. Try reloading the page."}
        </div>
      )}

      {data && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 pt-2">
            <PiggyBank className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl font-semibold">
              {bg ? "Пенсии (ДОО)" : "Pensions (ДОО)"}
            </h1>
          </div>

          {/* KPI row */}
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            {latestNational?.pensionerCount != null && (
              <StatCard
                label={bg ? "Пенсионери" : "Pensioners"}
                hint={`31.12.${data.latestYear}`}
              >
                <span className="text-2xl font-bold tabular-nums">
                  {formatInt(latestNational.pensionerCount, lang)}
                </span>
              </StatCard>
            )}
            {latestNational?.avgPensionEur != null && (
              <StatCard
                label={bg ? "Средна пенсия" : "Average pension"}
                hint={bg ? "месечно" : "monthly"}
              >
                <span className="text-2xl font-bold tabular-nums">
                  €
                  {latestNational.avgPensionEur.toLocaleString(lang, {
                    maximumFractionDigits: 0,
                  })}
                </span>
              </StatCard>
            )}
            {fundYear && (
              <StatCard
                label={bg ? "Изплатени пенсии" : "Pensions paid"}
                hint={`ДОО, ${fundYear.fiscalYear}`}
              >
                <span className="text-2xl font-bold tabular-nums">
                  {formatEurCompact(fundYear.pensionsEur, lang)}
                </span>
              </StatCard>
            )}
            {latestDist?.minPensionBgn != null && (
              <StatCard
                label={bg ? "Минимална пенсия" : "Minimum pension"}
                hint={`${data.latestYear}`}
              >
                <span className="text-2xl font-bold tabular-nums">
                  {latestDist.minPensionBgn.toLocaleString(lang, {
                    maximumFractionDigits: 0,
                  })}{" "}
                  лв
                </span>
              </StatCard>
            )}
          </div>

          {/* Hero — who pays */}
          {fundYear && (
            <PensionFundingTile
              fundYear={fundYear}
              pensionerCount={latestNational?.pensionerCount ?? null}
            />
          )}

          {/* The flagship — the reform sandbox */}
          <PensionReformTile />

          {/* The distribution — the shape the average hides */}
          {latestDist && <PensionDistributionTile data={latestDist} />}

          {/* Geography — average pension + cash-collection, per oblast */}
          <PensionOblastMapTile />
          <PensionCashMapTile />

          {/* The long series */}
          {data.national.length > 1 && (
            <PensionLongSeriesTile national={data.national} />
          )}

          {/* What pension will I get — the replacement-rate signature */}
          <PensionReplacementTile />

          {/* The long-run projection to 2070 */}
          <PensionProjectionTile />

          {/* Pillars 2 & 3 — the funded private half (КФН) */}
          <KfnFundsTile />

          <p className="text-[11px] text-muted-foreground/80">
            {bg
              ? "Източник: НОИ — статистически годишник „Пенсии“ и месечни отчети B1. Виж и обществените поръчки на НОИ."
              : "Source: НОИ — the pension statistical yearbook and monthly B1 reports. See also НОИ's public procurement."}
          </p>
        </div>
      )}
    </>
  );
};
