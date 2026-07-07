// "Колко струва администрацията" — НОИ's administrative cost (Персонал +
// Издръжка) as a share of what the funds pay out, plotted against comparable
// social-security carriers abroad. Same reference-band idea as the roads €/km
// tile: a shared axis with international marks and НОИ's own point on it. The
// ratio is computed from OUR ingested B1 execution, not the budget law, so it's
// an execution-basis figure — and it lands honestly inside the SSA–DRV band, a
// non-gotcha result that builds trust rather than manufacturing a scandal.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Scale } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import {
  NOI_ADMIN_BENCHMARK,
  NOI_PENSIONERS_BY_YEAR,
} from "@/lib/noiBenchmarks";
import type { NoiFundYear } from "@/data/procurement/useNoi";

const { ssa, drvLo, drvHi } = NOI_ADMIN_BENCHMARK;

const fmtPct = (v: number, lang: string) =>
  (v * 100).toLocaleString(lang, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + "%";

export const NoiAdminBenchmarkTile: FC<{
  fundYear: NoiFundYear;
  /** Procurement € in the SAME fund year (fundYear.fiscalYear), so the
   *  operating-base ratio compares like periods. Null when that year is out of
   *  the scoped window → the ratio KPI hides. */
  fundYearProcurementEur: number | null;
}> = ({ fundYear, fundYearProcurementEur }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";

  const benefitsEur = fundYear.pensionsEur + fundYear.benefitsEur;
  if (benefitsEur <= 0 || fundYear.adminEur <= 0) return null;
  const ratio = fundYear.adminEur / benefitsEur;

  // Axis 0 → a bit above the highest of {НОИ ratio, DRV high}.
  const scaleMax = Math.max(ratio, drvHi) * 1.25;
  const pos = (v: number) =>
    `${Math.max(0, Math.min(100, (v / scaleMax) * 100))}%`;

  // Headcount for the SAME fund year, or null → the per-pensioner KPI hides
  // rather than dividing by a stale year's count.
  const pensioners = NOI_PENSIONERS_BY_YEAR[fundYear.fiscalYear] ?? null;
  const perPensioner =
    pensioners != null ? fundYear.adminEur / pensioners : null;
  // Procurement's share of the non-personnel operating base — the zIndex "how
  // much of the addressable operating spend runs through public tender" lens.
  // The denominator is издръжка + капиталови (both are procured), matching the
  // numerator, which spans operating goods/services AND capital acquisitions —
  // dividing by издръжка alone mixed bases and overstated the ratio.
  const operatingBaseEur = fundYear.operationsEur + fundYear.capitalEur;
  const procShareOfOps =
    fundYearProcurementEur != null && operatingBaseEur > 0
      ? fundYearProcurementEur / operatingBaseEur
      : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Scale className="h-4 w-4" />
          {bg
            ? "Разходи за администрация спрямо международни ориентири"
            : "Administrative cost vs international benchmarks"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-2xl font-bold tabular-nums">
            {fmtPct(ratio, lang)}
          </span>
          <span className="text-sm text-muted-foreground">
            {bg
              ? `от изплатените пенсии и обезщетения (${formatEurCompact(fundYear.adminEur, lang)} администрация, ${fundYear.fiscalYear})`
              : `of pensions & benefits paid (${formatEurCompact(fundYear.adminEur, lang)} administration, ${fundYear.fiscalYear})`}
          </span>
        </div>

        {/* Reference labels */}
        <div className="relative h-4 ml-0">
          <span
            className="absolute -translate-x-1/2 text-[10px] font-medium text-muted-foreground whitespace-nowrap"
            style={{ left: pos(ssa) }}
            title={bg ? "US SSA" : "US SSA"}
          >
            SSA
          </span>
          <span
            className="absolute -translate-x-1/2 text-[10px] font-medium text-muted-foreground whitespace-nowrap"
            style={{ left: pos((drvLo + drvHi) / 2) }}
            title={bg ? "Германия (DRV)" : "Germany (DRV)"}
          >
            DRV
          </span>
        </div>

        {/* Axis with the DRV band, SSA mark and НОИ's point */}
        <div className="relative h-6">
          {/* DRV band */}
          <span
            className="absolute inset-y-0 bg-emerald-500/10 border-x border-emerald-500/30"
            style={{
              left: pos(drvLo),
              right: `${100 - parseFloat(pos(drvHi))}%`,
            }}
            aria-hidden
          />
          {/* SSA mark */}
          <span
            className="absolute inset-y-0 w-px bg-border"
            style={{ left: pos(ssa) }}
            aria-hidden
          />
          {/* НОИ point */}
          <span
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-4 w-4 rounded-full bg-primary ring-2 ring-background"
            style={{ left: pos(ratio) }}
            title={`НОИ ${fmtPct(ratio, lang)}`}
          />
          <span
            className="absolute -bottom-4 -translate-x-1/2 text-[10px] font-semibold text-primary whitespace-nowrap"
            style={{ left: pos(ratio) }}
          >
            НОИ
          </span>
        </div>

        <div className="pt-3 grid gap-2 sm:grid-cols-2 text-xs">
          {perPensioner != null && (
            <div className="rounded-md border bg-muted/30 p-2">
              <div className="text-muted-foreground">
                {bg
                  ? "Администрация на пенсионер"
                  : "Administration per pensioner"}
              </div>
              <div className="font-semibold tabular-nums">
                {formatEurCompact(perPensioner, lang)}
                <span className="ml-1 font-normal text-muted-foreground">
                  {bg ? "/ година" : "/ year"}
                </span>
              </div>
            </div>
          )}
          {procShareOfOps != null && (
            <div className="rounded-md border bg-muted/30 p-2">
              <div className="text-muted-foreground">
                {bg
                  ? `Поръчки / издръжка + капиталови (${fundYear.fiscalYear})`
                  : `Procurement / operations + capital (${fundYear.fiscalYear})`}
              </div>
              <div className="font-semibold tabular-nums">
                {(procShareOfOps * 100).toLocaleString(lang, {
                  maximumFractionDigits: 0,
                })}
                %
              </div>
            </div>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `Точката е НОИ (${fmtPct(ratio, lang)}); зелената зона е ориентир ${fmtPct(drvLo, lang)}–${fmtPct(drvHi, lang)} (немските осигурителни каси DRV), а SSA е администрацията на американската социална система (~${fmtPct(ssa, lang)}). Ориентирите не са пряко сравними — обхватът и какво се брои за „администрация" се различават по държави. Изчислено от касовото изпълнение (B1), не от закона.`
            : `The dot is НОИ (${fmtPct(ratio, lang)}); the green zone marks ${fmtPct(drvLo, lang)}–${fmtPct(drvHi, lang)} (German DRV carriers) and SSA is the US Social Security Administration (~${fmtPct(ssa, lang)}). References are not like-for-like — scope and what counts as "administration" differ by country. Computed from B1 cash execution, not the budget law.`}
        </p>
      </CardContent>
    </Card>
  );
};
