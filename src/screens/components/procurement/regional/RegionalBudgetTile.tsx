// „Бюджетът на МРРБ и разривът на прозрачност" — the ministry-budget context tile with
// the pass-through contrast. МРРБ controls ~€1.06bn/year (2025 ЗДБ), but only a thin
// slice (~€100M) passes through its OWN procurement — the rest leaves as capital
// transfers to municipalities and EU-cohesion co-financing. This tile shows the enacted
// expenditure trend and names the invisible majority. Mirrors EnvironmentBudgetTile;
// authoritative figure is the ЗДБ per-ministry node (expenditure.amountEur).
//
// NB the €100M is the WHOLE МРРБ group procurement (ministry + АГКК + ДНСК + governors),
// so the "own tenders" slice is even thinner for the ministry line alone.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { useBudgetMinistryRollup } from "@/data/budget/useBudget";
import { REGIONAL_BUDGET_NODE } from "@/lib/regionalReferenceData";

export const RegionalBudgetTile: FC<{ procEur: number | null }> = ({
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
  if (!years.length) return null;

  const latest = years[years.length - 1];
  const budget = latest.expenditure.amountEur;
  const maxBudget = Math.max(...years.map((y) => y.expenditure.amountEur), 1);
  // The visible slice: group procurement as a share of the latest budget year.
  const procShare = procEur != null && budget > 0 ? procEur / budget : null;

  return (
    <Card id="regional-budget">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Landmark className="h-4 w-4" />
          {bg
            ? "Бюджетът на МРРБ и разривът на прозрачност"
            : "The МРРБ budget and the transparency gap"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-2xl font-bold tabular-nums">
            {formatEurCompact(budget, lang)}
          </span>
          <span className="text-xs text-muted-foreground">
            {bg
              ? `бюджет на министерството, ${latest.fiscalYear} г.`
              : `ministry budget, ${latest.fiscalYear}`}
          </span>
        </div>

        {/* The pass-through bar: the thin procurement slice vs the whole envelope. */}
        {procShare != null && (
          <div>
            <div className="mb-1 flex items-baseline justify-between text-[11px] text-muted-foreground">
              <span>
                {bg ? "През собствени поръчки" : "Through own procurement"}:{" "}
                <span className="font-semibold tabular-nums text-foreground">
                  {formatEurCompact(procEur ?? 0, lang)}
                </span>{" "}
                (
                {(procShare * 100).toLocaleString(lang, {
                  maximumFractionDigits: procShare < 0.1 ? 1 : 0,
                })}
                %)
              </span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{
                  width: `${Math.max(1.5, Math.min(100, procShare * 100))}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Budget trend. */}
        <div className="flex items-end gap-1" style={{ height: 44 }}>
          {years.map((y) => (
            <div
              key={y.fiscalYear}
              className="flex-1"
              title={`${y.fiscalYear}: ${formatEurCompact(y.expenditure.amountEur, lang)}`}
            >
              <div
                className={`w-full rounded-t ${
                  y.fiscalYear === latest.fiscalYear
                    ? "bg-primary"
                    : "bg-primary/35"
                }`}
                style={{
                  height: `${Math.max(3, (y.expenditure.amountEur / maxBudget) * 44)}px`,
                }}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
          <span>{years[0].fiscalYear}</span>
          <span>{latest.fiscalYear}</span>
        </div>

        <p className="text-sm leading-snug">
          {bg ? (
            <>
              МРРБ е{" "}
              <span className="font-semibold">министерство-разпределител</span>:
              то насочва милиарди, но през собствените си обществени поръчки
              минава само тънка част. Останалото напуска като{" "}
              <span className="font-semibold">
                капиталови трансфери към общините
              </span>{" "}
              и съфинансиране на европейската кохезия — пари, които МРРБ
              насочва, но не възлага само̀. Годишният бюджет е волатилен, защото
              е капиталово-тежък (пикове в годините на усвояване).
            </>
          ) : (
            <>
              МРРБ is a{" "}
              <span className="font-semibold">pass-through ministry</span>: it
              directs billions, but only a thin slice flows through its own
              procurement. The rest leaves as{" "}
              <span className="font-semibold">
                capital transfers to municipalities
              </span>{" "}
              and EU-cohesion co-financing — money МРРБ directs but does not
              itself award. The annual budget is volatile because it is
              capital-heavy (peaks in absorption years).
            </>
          )}
        </p>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Източник: Закон за държавния бюджет (админ. единица „Министерство на регионалното развитие и благоустройството“), разход в евро. „През собствени поръчки“ е стойността на договорите на цялата група МРРБ (министерство + АГКК + ДНСК + областни администрации) от регистъра."
            : "Source: State Budget Law (МРРБ admin unit), expenditure in EUR. „Through own procurement“ is the contract value of the whole МРРБ group (ministry + АГКК + ДНСК + regional governors) from the register."}
        </p>
      </CardContent>
    </Card>
  );
};
