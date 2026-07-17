// „Къде отиват парите на МРРБ" — the pass-through / inverse-iceberg hero (tile 1, the OG
// screenshot target). The single killer contrast: МРРБ controls the whole ЗДБ envelope
// (€1.06bn in 2025) but only a thin slice (~€26M, ~2%) passes through its OWN procurement
// — the rest leaves as capital transfers to municipalities + EU-cohesion co-financing. A
// part-to-whole bar makes the invisible majority legible. data-og="regional-hero".
//
// ⚠ LIKE-FOR-LIKE BASIS (annual, not scoped). The budget is an ANNUAL figure, so the
// procurement it is compared against MUST be the SAME calendar year — not the ?pscope
// window (a part-year parliament slice would read as a fake ~0.1%). So this tile runs its
// own group-model call windowed to the latest budget year and, like the budget/COFOG
// tiles, IGNORES scopeWindow (plan §6: annual reference tiles pin to the latest year).
// The window is half-open [Y-01-01, Y+1-01-01) to match awarder_group_model's
// `date < COALESCE(p_to,…)` (audit C5).
//
// The inverse of МВР's iceberg (whose invisible money is payroll): МРРБ's is TRANSFERS —
// money it directs but does not itself procure.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { useBudgetMinistryRollup } from "@/data/budget/useBudget";
import { useAwarderGroupModel } from "@/data/procurement/useAwarderGroupModel";
import { buildRegionalModelFromAggregates } from "@/lib/regionalAttributes";
import {
  REGIONAL_BUDGET_NODE,
  REGIONAL_SECTOR_EIKS,
} from "@/lib/regionalReferenceData";

export const RegionalPassThroughHero: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";

  const { data } = useBudgetMinistryRollup(REGIONAL_BUDGET_NODE);
  const latest = useMemo(() => {
    const years = (data?.years ?? [])
      .filter(
        (
          y,
        ): y is typeof y & { expenditure: NonNullable<typeof y.expenditure> } =>
          y.expenditure != null,
      )
      .sort((a, b) => a.fiscalYear - b.fiscalYear);
    return years[years.length - 1] ?? null;
  }, [data]);

  const year = latest?.fiscalYear ?? null;
  // Same-year procurement — half-open [Y-01-01, Y+1-01-01).
  const window = useMemo(
    () =>
      year != null
        ? { from: `${year}-01-01`, to: `${year + 1}-01-01` }
        : { from: null, to: null },
    [year],
  );
  const { model } = useAwarderGroupModel(
    REGIONAL_SECTOR_EIKS,
    buildRegionalModelFromAggregates,
    window,
    year != null,
  );

  const budget = latest?.expenditure.amountEur ?? null;
  const procEur = model?.totalEur ?? null;
  if (!budget || budget <= 0 || procEur == null || year == null) return null;

  const procShare = Math.min(1, procEur / budget);
  const procPct = procShare * 100;

  return (
    <Card id="regional-hero" data-og="regional-hero">
      <CardContent className="p-4 md:p-5 space-y-3">
        <p className="text-lg font-semibold leading-snug">
          {bg ? (
            <>
              През {year} г. МРРБ управлява{" "}
              <span className="text-primary">
                {formatEurCompact(budget, lang)}
              </span>
              , но само{" "}
              <span className="text-primary">
                {formatEurCompact(procEur, lang)}
              </span>{" "}
              минават през собствени поръчки.
            </>
          ) : (
            <>
              In {year} МРРБ directed{" "}
              <span className="text-primary">
                {formatEurCompact(budget, lang)}
              </span>
              , but only{" "}
              <span className="text-primary">
                {formatEurCompact(procEur, lang)}
              </span>{" "}
              passed through its own procurement.
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
              {formatEurCompact(budget, lang)} · {year}
            </span>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `МРРБ е министерство-разпределител: „айсбергът“ му е обратен на този на МВР (чиито скрити пари са заплати) — при МРРБ скритото са трансферите, пари които насочва, но не възлага само̀. И двете числа са за ${year} г. (еднаква база, независимо от избрания обхват). Бюджет: ЗДБ (разход в евро). Поръчки: цялата група МРРБ от регистъра (АОП/ЦАИС ЕОП).`
            : `МРРБ is a pass-through ministry: its „iceberg“ is the inverse of МВР's (whose hidden money is payroll) — here the hidden part is transfers, money it directs but does not itself award. Both figures are for ${year} (a like-for-like basis, independent of the selected scope). Budget: State Budget Law (EUR). Procurement: the whole МРРБ group from the register (АОП/ЦАИС ЕОП).`}
        </p>
      </CardContent>
    </Card>
  );
};
