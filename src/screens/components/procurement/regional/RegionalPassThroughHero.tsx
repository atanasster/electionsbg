// „Къде отиват парите на МРРБ" — the pass-through / inverse-iceberg hero (tile 1, the OG
// screenshot target). The single killer contrast: МРРБ controls the whole ЗДБ envelope
// (€1.06bn in 2025) but only a thin slice (~€26M, ~2%) passes through its OWN procurement
// — the rest leaves as capital transfers to municipalities + EU-cohesion co-financing. A
// part-to-whole bar makes the invisible majority legible. data-og="regional-hero".
//
// ⚠ LIKE-FOR-LIKE BASIS (annual, not scoped). The budget is an ANNUAL figure, so the
// procurement it is compared against MUST be the SAME calendar year — not the ?pscope
// window (a part-year parliament slice would read as a fake ~0.1%). So this tile runs its
// own group-model call windowed to a budget year and, like the budget/COFOG tiles,
// IGNORES scopeWindow (plan §6: annual reference tiles pin to a fixed year). The window
// is half-open [Y-01-01, Y+1-01-01) to match awarder_group_model's
// `date < COALESCE(p_to,…)` (audit C5).
//
// ⚠ AND THAT YEAR MUST BE COMPLETE — `latestCompleteFiscalYear`, never the newest year in
// the node. The defence above covers the ?pscope window and NOT the calendar year, so once
// the budget series gained its current year the tile reintroduced the same fake share
// through the other door: measured 2026-08-13, it rendered „През 2026 … само €9,2 млн. …
// 0,9%" from 7 months of a 12-month appropriation, against 2025's true 2,4%. The caption
// asserts a like-for-like basis, so the year it names has to be one — and when the helper
// has to fall back to an unfinished year, the caption says THAT instead. Certifying a
// basis you do not have is worse than the original defect, not a smaller version of it.
//
// The inverse of МВР's iceberg (whose invisible money is payroll): МРРБ's is TRANSFERS —
// money it directs but does not itself procure.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { useBudgetMinistryRollup } from "@/data/budget/useBudget";
import {
  latestCompleteFiscalYear,
  ministryEurSeries,
} from "@/data/budget/ministrySeries";
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
  // Same series rule as RegionalBudgetTile, so the two cannot name one year and
  // show different money for it.
  const reference = useMemo(
    () =>
      latestCompleteFiscalYear(
        ministryEurSeries(data?.years),
        new Date().getUTCFullYear(),
      ),
    [data],
  );

  const year = reference?.row.fiscalYear ?? null;
  // The helper falls back to the current year when the node has nothing older. The
  // caption below asserts a basis, so it may only make that assertion when it holds.
  const complete = reference?.complete ?? false;
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

  const budget = reference?.row.eur ?? null;
  const procEur = model?.totalEur ?? null;
  if (!budget || budget <= 0 || procEur == null || year == null) return null;

  // NOT clamped to 1. On a tile whose thesis is „the procured slice is thin", a
  // ratio above 100% does not mean 100% — it means the basis broke (wrong reference
  // year, an EIK set that grew, an annex-inflated total against a shrunken
  // appropriation). A visible 137% is a bug report; a clamped 100% destroys the only
  // signal that anything is wrong.
  const procPct = (procEur / budget) * 100;
  const overflowed = procPct > 100;
  // The BAR is clamped — 1% so a thin slice is visible at all, 100% so it cannot
  // overflow its track. The label above prints the true value either way.
  const barPct = Math.min(100, Math.max(1, procPct));
  const pctLabel = `${procPct.toLocaleString(lang, {
    maximumFractionDigits: procPct < 10 ? 1 : 0,
  })}%`;

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
          <div
            className="relative h-7 w-full overflow-hidden rounded-md bg-muted"
            role="img"
            aria-label={
              bg
                ? `Собствени поръчки ${pctLabel} от бюджета за ${year} г.; останалото — трансфери към общини и европейско съфинансиране`
                : `Own procurement ${pctLabel} of the ${year} budget; the rest — transfers to municipalities and EU co-financing`
            }
          >
            <div
              className="absolute inset-y-0 left-0 rounded-md bg-primary"
              style={{ width: `${barPct}%` }}
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
              {pctLabel}
              {overflowed
                ? bg
                  ? " — проверете базата"
                  : " — check the basis"
                : ""}
            </span>
            <span className="text-muted-foreground">
              {bg ? "целият бюджет" : "the whole budget"}{" "}
              {formatEurCompact(budget, lang)} · {year}
            </span>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `МРРБ е министерство-разпределител: „айсбергът“ му е обратен на този на МВР (чиито скрити пари са заплати) — при МРРБ скритото са трансферите, пари които насочва, но не възлага само̀. И двете числа са за ${year} г.${
                complete
                  ? " — последната приключила година, защото бюджетът е за цяла година, а поръчките в текущата още текат (еднаква база, независимо от избрания обхват)"
                  : " — текуща, незавършила година: бюджетът е за цялата ѝ, а поръчките още текат, така че делът е подценен (няма по-ранна година в бюджетния възел)"
              }. Бюджет: ЗДБ (разход в евро). Поръчки: цялата група МРРБ от регистъра (АОП/ЦАИС ЕОП).`
            : `МРРБ is a pass-through ministry: its „iceberg“ is the inverse of МВР's (whose hidden money is payroll) — here the hidden part is transfers, money it directs but does not itself award. Both figures are for ${year}${
                complete
                  ? " — the last complete year, because the budget is a whole-year figure while the current year's procurement is still running (a like-for-like basis, independent of the selected scope)"
                  : " — a current, unfinished year: the budget covers all of it while its procurement is still running, so the share is understated (the budget node carries no earlier year)"
              }. Budget: State Budget Law (EUR). Procurement: the whole МРРБ group from the register (АОП/ЦАИС ЕОП).`}
        </p>
      </CardContent>
    </Card>
  );
};
