// „Къде отиват парите на МРРБ" — the pass-through / inverse-iceberg hero (tile 1, the OG
// screenshot target). The single killer contrast: МРРБ controls the whole ЗДБ envelope
// (~€1.06bn/year) but only a thin slice (~€100M) passes through its OWN procurement — the
// rest leaves as capital transfers to municipalities + EU-cohesion co-financing. A
// part-to-whole bar makes the invisible majority legible. data-og="regional-hero".
//
// The inverse of МВР's iceberg (whose invisible money is payroll): МРРБ's is TRANSFERS —
// money it directs but does not itself procure.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { useBudgetMinistryRollup } from "@/data/budget/useBudget";
import { REGIONAL_BUDGET_NODE } from "@/lib/regionalReferenceData";

export const RegionalPassThroughHero: FC<{ procEur: number | null }> = ({
  procEur,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data } = useBudgetMinistryRollup(REGIONAL_BUDGET_NODE);
  const years = (data?.years ?? [])
    .filter(
      (y): y is typeof y & { expenditure: NonNullable<typeof y.expenditure> } =>
        y.expenditure != null,
    )
    .sort((a, b) => a.fiscalYear - b.fiscalYear);
  const latest = years[years.length - 1];
  const budget = latest?.expenditure.amountEur ?? null;
  if (!budget || budget <= 0 || procEur == null) return null;

  const procShare = Math.min(1, procEur / budget);
  const procPct = procShare * 100;

  return (
    <Card id="regional-hero" data-og="regional-hero">
      <CardContent className="p-4 md:p-5 space-y-3">
        <p className="text-lg font-semibold leading-snug">
          {bg ? (
            <>
              МРРБ управлява{" "}
              <span className="text-primary">
                {formatEurCompact(budget, lang)}
              </span>{" "}
              годишно, но само{" "}
              <span className="text-primary">
                {formatEurCompact(procEur, lang)}
              </span>{" "}
              минават през собствени поръчки.
            </>
          ) : (
            <>
              МРРБ directs{" "}
              <span className="text-primary">
                {formatEurCompact(budget, lang)}
              </span>{" "}
              a year, but only{" "}
              <span className="text-primary">
                {formatEurCompact(procEur, lang)}
              </span>{" "}
              passes through its own procurement.
            </>
          )}
        </p>

        {/* Part-to-whole: the whole envelope, with the thin procured slice filled. */}
        <div className="space-y-1.5">
          <div className="relative h-7 w-full overflow-hidden rounded-md bg-muted">
            <div
              className="absolute inset-y-0 left-0 rounded-md bg-primary"
              style={{ width: `${Math.max(1, procPct)}%` }}
            />
            <div className="absolute inset-0 flex items-center justify-end pr-2">
              <span className="text-[11px] font-medium text-muted-foreground">
                {bg
                  ? "трансфери към общини + европейско съфинансиране"
                  : "transfers to municipalities + EU co-financing"}
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between text-[11px] tabular-nums">
            <span className="font-medium text-primary">
              {bg ? "собствени поръчки " : "own procurement "}
              {procPct.toLocaleString(lang, {
                maximumFractionDigits: procPct < 10 ? 1 : 0,
              })}
              %
            </span>
            <span className="text-muted-foreground">
              {bg ? "целият бюджет" : "the whole budget"}{" "}
              {formatEurCompact(budget, lang)}
              {latest ? ` · ${latest.fiscalYear}` : ""}
            </span>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "МРРБ е министерство-разпределител: „айсбергът“ му е обратен на този на МВР (чиито скрити пари са заплати) — при МРРБ скритото са трансферите, пари които насочва, но не възлага само̀. Бюджет: ЗДБ (разход в евро). Поръчки: цялата група МРРБ от регистъра (АОП/ЦАИС ЕОП)."
            : "МРРБ is a pass-through ministry: its „iceberg“ is the inverse of МВР's (whose hidden money is payroll) — here the hidden part is transfers, money it directs but does not itself award. Budget: State Budget Law (EUR). Procurement: the whole МРРБ group from the register (АОП/ЦАИС ЕОП)."}
        </p>
      </CardContent>
    </Card>
  );
};
