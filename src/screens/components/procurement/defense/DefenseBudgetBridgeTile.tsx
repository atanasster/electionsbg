// "Поръчките в мащаба на бюджета на МО" — the honest money-first bridge (the
// pattern the НЗОК/НОИ/ВСС packs are built on). It places the visible ЗОП
// procurement inside the REAL МО budget (from the per-ministry budget tree that
// update-budget already ingests) so the reader sees how small the competed slice
// is — and names what sits OUTSIDE it: the classified FMS acquisition (F-16,
// Stryker) that never enters the register. The budget has doubled since 2018,
// shown as a mini trend.
//
// Honesty rules copied from NzokBudgetBridgeTile: a rounding floor (never "~0%"),
// period-matched figures (the budget year is labelled), and the FMS acquisition
// shown as an explicit out-of-budget callout, not folded into a fake denominator.
// data-og="defense-hero" — the awarder-pack OG anchor.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { useBudgetMinistryRollup } from "@/data/budget/useBudget";
import { MO_BUDGET_NODE } from "@/lib/defenseReferenceData";

export const DefenseBudgetBridgeTile: FC<{
  /** Visible ЗОП procurement across the group in the active scope. When `perYear`
   *  it's the annual figure; otherwise the total for a partial period (copy drops
   *  "на година"). */
  procEur: number | null;
  perYear: boolean;
}> = ({ procEur, perYear }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data } = useBudgetMinistryRollup(MO_BUDGET_NODE);
  // `expenditure` is null for law/shell years with no figure — drop those before
  // the bridge maths so a null year can't crash the whole pack.
  const years = (data?.years ?? [])
    .filter(
      (y): y is typeof y & { expenditure: NonNullable<typeof y.expenditure> } =>
        y.expenditure != null,
    )
    .sort((a, b) => a.fiscalYear - b.fiscalYear);
  if (!years.length) return null;

  const latest = years[years.length - 1];
  const first = years[0];
  const budget = latest.expenditure.amountEur;
  const growth =
    first.expenditure.amountEur > 0
      ? budget / first.expenditure.amountEur
      : null;
  const maxBudget = Math.max(...years.map((y) => y.expenditure.amountEur), 1);

  const proc = procEur ?? 0;
  const procShare = budget > 0 ? proc / budget : 0;
  const shareLabel =
    procShare <= 0 || budget <= 0
      ? "—"
      : procShare < 0.005
        ? bg
          ? "под 0,5%"
          : "under 0.5%"
        : `~${(procShare * 100).toLocaleString(lang, { maximumFractionDigits: 0 })}%`;

  return (
    <Card id="defense-bridge">
      <CardContent data-og="defense-hero" className="p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-2xl font-bold tabular-nums">
            {formatEurCompact(budget, lang)}
          </span>
          <span className="text-xs text-muted-foreground">
            {bg
              ? `бюджет на МО, ${latest.fiscalYear} г.`
              : `МО budget, ${latest.fiscalYear}`}
          </span>
          {growth != null && growth >= 1.5 && (
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              ×{growth.toLocaleString(lang, { maximumFractionDigits: 1 })}{" "}
              {bg ? `от ${first.fiscalYear}` : `since ${first.fiscalYear}`}
            </span>
          )}
        </div>

        {/* Budget growth trend — the doubling since 2018. */}
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
          <span>{first.fiscalYear}</span>
          <span>{latest.fiscalYear}</span>
        </div>

        <p className="text-sm leading-snug">
          {bg ? (
            <>
              Видимите обществени поръчки на МО{perYear ? " " : " за периода "}(
              <span className="font-semibold tabular-nums">
                {formatEurCompact(proc, lang)}
              </span>
              {perYear ? " на година) " : ") "}са{" "}
              <span className="font-semibold">{shareLabel}</span> от{" "}
              {perYear ? "този" : "годишния"} бюджет. Останалото са заплати,
              издръжка и инвестиции.
            </>
          ) : (
            <>
              МО's visible public procurement
              {perYear ? " (" : " for the period ("}
              <span className="font-semibold tabular-nums">
                {formatEurCompact(proc, lang)}
              </span>
              {perYear ? "/year) " : ") "}is{" "}
              <span className="font-semibold">{shareLabel}</span> of{" "}
              {perYear ? "this" : "the annual"} budget. The rest is salaries,
              upkeep and investment.
            </>
          )}
        </p>

        {/* The acquisition that sits OUTSIDE the budget line and the register. */}
        <div className="rounded-md border border-dashed border-primary/40 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
          {bg
            ? "Извън този бюджет и извън регистъра на поръчките: придобиването на F-16 (~2,6 млрд. $) и Stryker (~1,38 млрд. $) по линия на US FMS — междудържавни сделки, финансирани отделно."
            : "Outside this budget line and outside the procurement register: the F-16 (~$2.6bn) and Stryker (~$1.38bn) acquisitions via US FMS — government-to-government deals, funded separately."}
        </div>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Бюджет: Закон за държавния бюджет (админ. единица „Министерство на отбраната“). Поръчки: АОП/ЦАИС ЕОП."
            : "Budget: State Budget Law (МО admin unit). Procurement: АОП/ЦАИС ЕОП register."}
        </p>
      </CardContent>
    </Card>
  );
};
