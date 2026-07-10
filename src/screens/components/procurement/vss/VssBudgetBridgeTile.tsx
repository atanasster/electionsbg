// "Къде отиват парите на съдебната власт" — the hero that sets the ВСС's public
// procurement inside the judiciary it administers. Two things no procurement
// portal and no ВСС report show together:
//
//  1. The per-body split of the judiciary's budget (ЗДБРБ, чл. „Бюджет на
//     съдебната власт"): the courts and the prosecution take ~87% of it, while
//     the ВСС's own line is a rounding error — yet the ВСС is the buyer that
//     procures the courthouses and the e-justice systems for the whole system.
//  2. Self-financing: the judiciary raises real money of its own (съдебни такси,
//     глоби), covering a double-digit share of its own costs. That ratio is
//     printed in the budget law and nowhere else.
//
// Pure presentation from a JudiciaryBudgetYear + the pack's procurement figures.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Scale } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact, formatPct as pct } from "@/lib/currency";
import { BODY_COLOR } from "@/lib/vssReferenceData";
import type { JudiciaryBudgetYear } from "@/data/budget/types";

export const VssBudgetBridgeTile: FC<{
  year: JudiciaryBudgetYear;
  years: number[];
  selectedYear: number;
  onSelectYear: (y: number) => void;
  /** Total ЗОП procurement € in scope + how it annualises, from the pack. */
  procurementTotalEur: number;
  /** Length of the procurement window in years, and its bounds. The window is
   *  the scope pill's, NOT the budget's fiscal year — the two are independent,
   *  so the sentence below has to name both rather than imply one period. */
  procurementYears: number | null;
  procurementFrom: number | null;
  procurementTo: number | null;
  annualProc: number | null;
}> = ({
  year,
  years,
  selectedYear,
  onSelectYear,
  procurementTotalEur,
  procurementYears,
  procurementFrom,
  procurementTo,
  annualProc,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const eur = (v: number) => formatEurCompact(v, lang);

  const total = year.totalExpenditure.amountEur;
  const revenue = year.totalRevenue.amountEur;
  const selfFinance = total > 0 ? revenue / total : 0;
  const courtFees =
    year.revenue.find((r) => r.id === "courtFees")?.amount.amountEur ?? 0;

  // Per-body segments, biggest first. The reserve is tiny and sinks to the tail.
  const segments = year.bodies
    .map((b) => ({
      id: b.id,
      label: bg ? b.bg : b.en,
      value: b.amount.amountEur,
      // Data-driven from budget.json: if the ЗДБРБ table ever gains a spending
      // body, an undefined class renders an invisible segment that still eats
      // bar width. Same guard as VssCategoryTile.
      color: BODY_COLOR[b.id] ?? "bg-muted",
    }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);

  const vssLine =
    year.bodies.find((b) => b.id === "vss")?.amount.amountEur ?? 0;

  // Procurement bridge — the annualised procurement of the SCOPE WINDOW against
  // the SELECTED BUDGET YEAR. Those are two different periods (the scope pill
  // defaults to a parliament's contract window; the budget defaults to the newest
  // fiscal year), so the ratio is only honest if the sentence names both.
  const procShare = annualProc != null && total > 0 ? annualProc / total : null;
  const procWindow =
    procurementFrom != null && procurementTo != null
      ? procurementFrom === procurementTo
        ? `${procurementFrom}`
        : `${procurementFrom}–${procurementTo}`
      : null;
  const shareText =
    procShare == null
      ? null
      : procShare < 0.005
        ? bg
          ? "под 0,5%"
          : "under 0.5%"
        : `~${pct(procShare, lang)}`;

  return (
    // data-og: OG-card anchor (scripts/og/capture-screens.ts).
    <Card data-og="vss-bridge">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Scale className="h-4 w-4" />
            {bg
              ? `Бюджетът на съдебната власт (${year.fiscalYear})`
              : `The judiciary's budget (${year.fiscalYear})`}
          </CardTitle>
          {years.length > 1 && (
            <div
              className="flex flex-wrap gap-1"
              role="group"
              aria-label={bg ? "Финансова година" : "Fiscal year"}
            >
              {years.map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => onSelectYear(y)}
                  aria-pressed={y === selectedYear}
                  className={`rounded-full border px-2 py-0.5 text-xs font-medium transition-colors ${
                    y === selectedYear
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-4">
        {/* Headline */}
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-2xl font-bold tabular-nums">{eur(total)}</span>
          <span className="text-sm text-muted-foreground">
            {bg
              ? "общ разход по бюджета на съдебната власт (закон)"
              : "total judiciary budget expenditure (adopted law)"}
          </span>
        </div>

        {/* Self-financing — the judiciary's own revenue against its own costs */}
        {revenue > 0 && (
          <div className="rounded-md border bg-muted/30 p-3 text-xs">
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-2">
              <span className="text-muted-foreground">
                {bg
                  ? "Собствени приходи спрямо разходите"
                  : "Own revenue against costs"}
              </span>
              <span className="tabular-nums">
                <span className="font-semibold">{eur(revenue)}</span>
                <span className="ml-1 text-muted-foreground">
                  ({pct(selfFinance, lang)})
                </span>
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${Math.min(100, selfFinance * 100)}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {bg
                ? `Съдебните такси носят ${eur(courtFees)} — съдебната власт сама покрива ${pct(selfFinance, lang)} от разходите си; останалото идва от централния бюджет.`
                : `Court fees raise ${eur(courtFees)} — the judiciary self-funds ${pct(selfFinance, lang)} of its costs; the rest comes from the central budget.`}
            </p>
          </div>
        )}

        {/* Composition bar — per spending body */}
        <div>
          <div className="flex h-6 w-full overflow-hidden rounded-md">
            {segments.map((s) => {
              const w = total > 0 ? (s.value / total) * 100 : 0;
              if (w <= 0) return null;
              return (
                <div
                  key={s.id}
                  className={s.color}
                  style={{ width: `${w}%` }}
                  title={`${s.label}: ${eur(s.value)}`}
                />
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {segments.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-sm ${s.color}`} />
                <span className="text-muted-foreground">{s.label}</span>
                <span className="font-medium tabular-nums">{eur(s.value)}</span>
                <span className="text-muted-foreground/70 tabular-nums">
                  {pct(total > 0 ? s.value / total : 0, lang)}
                </span>
              </span>
            ))}
          </div>
        </div>

        {/* Procurement bridge — the point of the pack */}
        {procurementTotalEur > 0 && annualProc != null && shareText && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold tabular-nums">{shareText}</span>
              <span className="text-muted-foreground">
                {bg
                  ? `— толкова е средногодишната стойност на поръчките на ВСС за ${procWindow ?? "обхвата"} (${eur(procurementTotalEur)} общо за ${procurementYears ?? "—"} г., ~${eur(annualProc)}/г.) спрямо бюджета на съдебната власт за ${year.fiscalYear} г. Двата периода са различни — сравнението е за мащаб, не за изпълнение на конкретна година. Самият ВСС има бюджетно перо от ${eur(vssLine)}, но възлага централно за цялата система — съдебните сгради и системите за електронно правосъдие. Останалото е предимно заплати на магистрати и съдебни служители.`
                  : `— that is the ВСС's average annual procurement for ${procWindow ?? "the scope"} (${eur(procurementTotalEur)} over ${procurementYears ?? "—"} years, ~${eur(annualProc)}/yr) set against the judiciary's budget for ${year.fiscalYear}. The two periods differ — the comparison is for scale, not a single year's execution. The ВСС's own budget line is just ${eur(vssLine)}, but it procures centrally for the whole system — courthouses and the e-justice platforms. The rest is mostly magistrate and court-staff salaries.`}
              </span>
            </div>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `Разходите по органи и собствените приходи са от Закона за държавния бюджет за ${year.fiscalYear} г. (чл. „Бюджет на съдебната власт"). Сборът по органи е равен на общия разход. Поръчките са от регистъра на обществените поръчки (АОП/ЦАИС ЕОП).`
            : `Per-body expenditure and own revenue are from the ${year.fiscalYear} State Budget Law (the judiciary budget article). The per-body figures sum to the headline total. Procurement is from the public-procurement register.`}
        </p>
      </CardContent>
    </Card>
  );
};
