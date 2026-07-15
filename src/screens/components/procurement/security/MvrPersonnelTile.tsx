// "Разходи за персонал — колко струва един служител" — the cost-per-employee tile.
// МВР is ~90% payroll, so the single most telling budget number is the average
// annual cost of one employee. It reads the LIVE МВР budget total (ЗДБ, via the
// per-ministry budget tree) and divides the estimated personnel band by the curated
// headcount, so the euro figure stays anchored to ingested budget data.
//
// Honesty: both inputs that are NOT in the budget node — the ~90% personnel share
// and the ~46,000 headcount — are drawn as clearly-labelled estimates (the pack's
// convention, mirroring the iceberg tile's hatched "~90% est." band). The derivation
// is shown so the reader can see exactly how the headline is built.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur, formatEurCompact } from "@/lib/currency";
import { useBudgetMinistryRollup } from "@/data/budget/useBudget";
import { MVR_BUDGET_NODE } from "@/lib/securityReferenceData";
import { MVR_PERSONNEL } from "@/lib/securityPersonnel";

export const MvrPersonnelTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const loc = bg ? "bg-BG" : "en-US";
  const { data } = useBudgetMinistryRollup(MVR_BUDGET_NODE);

  const years = (data?.years ?? [])
    .filter(
      (y): y is typeof y & { expenditure: NonNullable<typeof y.expenditure> } =>
        y.expenditure != null,
    )
    .sort((a, b) => a.fiscalYear - b.fiscalYear);
  if (!years.length) return null;

  const latest = years[years.length - 1];
  const budget = latest.expenditure.amountEur;
  const { headcount, personnelShareEst } = MVR_PERSONNEL;
  const personnelBudget = budget * personnelShareEst;
  const perYear = personnelBudget / headcount;
  const perMonth = perYear / 12;

  return (
    <Card id="mvr-personnel-cost">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" />
          {bg ? "Колко струва един служител" : "Cost of one employee"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-2xl font-bold tabular-nums">
            ≈ {formatEur(Math.round(perMonth), loc)}
          </span>
          <span className="text-xs text-muted-foreground">
            {bg ? "средно на месец (оценка)" : "per month, average (est.)"}
          </span>
        </div>

        {/* The three inputs behind the headline — sourced total × est. share ÷
            est. headcount. Laid out as a mini stat row. */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md border bg-muted/30 px-2 py-2">
            <div className="text-sm font-bold tabular-nums">
              {formatEurCompact(personnelBudget, lang)}
            </div>
            <div className="text-[10px] leading-tight text-muted-foreground">
              {bg ? "разход за заплати" : "payroll cost"}
            </div>
          </div>
          <div className="rounded-md border bg-muted/30 px-2 py-2">
            <div className="text-sm font-bold tabular-nums">
              ~{headcount.toLocaleString(loc)}
            </div>
            <div className="text-[10px] leading-tight text-muted-foreground">
              {bg ? "заети (оценка)" : "employees (est.)"}
            </div>
          </div>
          <div className="rounded-md border bg-muted/30 px-2 py-2">
            <div className="text-sm font-bold tabular-nums">
              ~{Math.round(personnelShareEst * 100)}%
            </div>
            <div className="text-[10px] leading-tight text-muted-foreground">
              {bg ? "дял заплати" : "payroll share"}
            </div>
          </div>
        </div>

        <p className="text-sm leading-snug">
          {bg ? (
            <>
              При бюджет от{" "}
              <span className="font-semibold tabular-nums">
                {formatEurCompact(budget, lang)}
              </span>{" "}
              за {latest.fiscalYear} г., от който ~
              {Math.round(personnelShareEst * 100)}% са заплати, един служител
              струва средно{" "}
              <span className="font-semibold tabular-nums">
                {formatEur(Math.round(perYear), loc)}
              </span>{" "}
              на година.
            </>
          ) : (
            <>
              On a{" "}
              <span className="font-semibold tabular-nums">
                {formatEurCompact(budget, lang)}
              </span>{" "}
              budget for {latest.fiscalYear}, of which ~
              {Math.round(personnelShareEst * 100)}% is payroll, one employee
              costs on average{" "}
              <span className="font-semibold tabular-nums">
                {formatEur(Math.round(perYear), loc)}
              </span>{" "}
              per year.
            </>
          )}
        </p>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Бюджет: Закон за държавния бюджет (админ. единица „МВР“). Делът заплати ~90% и заетите ~46 000 са оценки (отчет за изпълнението / програмен бюджет), не са в бюджетния разрез по политики — затова „≈“. Пенсиите се плащат отделно от НОИ."
            : "Budget: State Budget Law (МВР admin unit). The ~90% payroll share and ~46,000 headcount are estimates (execution report / program budget), not in the by-policy split — hence “≈”. Pensions are paid separately by НОИ."}
        </p>
      </CardContent>
    </Card>
  );
};
