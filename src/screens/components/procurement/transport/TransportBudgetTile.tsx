// "Бюджетът на МТС и субсидията за железниците" — the ministry-budget context tile.
// Unlike the МВР iceberg (where procurement is a tiny tip of a huge payroll budget),
// the transport story is the OPPOSITE: the МТС *ministry* budget (~€575M, 2025) is
// SMALLER than the group's annual procurement, because the big money is the capital
// spend of the state rail/port ENTERPRISES (НКЖИ, БДЖ — largely EU-funded), which sit
// OUTSIDE the ministry budget. So this tile does NOT draw a procurement-vs-budget
// composition bar (that would mislead); it shows the ministry budget + its growth and
// names what the line actually carries: the state rail subsidy / PSO to БДЖ.
//
// Honesty: the budget TOTAL is the authoritative ЗДБ figure from the per-ministry node
// (expenditure.amountEur). The rail-subsidy framing is qualitative — the node carries
// no economic-type split — so no subsidy € is drawn as a measured band (that is the
// Phase-2 tile, which needs the budget-law PSO row + БДЖ revenue/ridership).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { useBudgetMinistryRollup } from "@/data/budget/useBudget";
import { TRANSPORT_BUDGET_NODE } from "@/lib/transportReferenceData";

export const TransportBudgetTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data } = useBudgetMinistryRollup(TRANSPORT_BUDGET_NODE);
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

  return (
    <Card id="transport-budget">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Landmark className="h-4 w-4" />
          {bg
            ? "Бюджетът на МТС и субсидията за железниците"
            : "The МТС budget & the rail subsidy"}
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
          {growth != null && growth >= 1.2 && (
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              ×{growth.toLocaleString(lang, { maximumFractionDigits: 1 })}{" "}
              {bg ? `от ${first.fiscalYear}` : `since ${first.fiscalYear}`}
            </span>
          )}
        </div>

        {/* Budget growth trend. */}
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
              Бюджетът на министерството носи държавната{" "}
              <span className="font-semibold">субсидия за железниците</span>{" "}
              (задължението за обществена услуга към „БДЖ — Пътнически превози“
              и вноската за железопътната инфраструктура на НКЖИ). Той е
              по-малък от годишните обществени поръчки на групата, защото
              капиталовите проекти на държавните предприятия (НКЖИ, БДЖ — до
              голяма степен с европейско финансиране) са извън този разход.
            </>
          ) : (
            <>
              The ministry budget carries the state{" "}
              <span className="font-semibold">rail subsidy</span> (the
              public-service obligation to „БДЖ — Passenger“ and the
              infrastructure grant to НКЖИ). It is smaller than the group's
              annual procurement, because the capital projects of the state
              enterprises (НКЖИ, БДЖ — largely EU-funded) sit outside this line.
            </>
          )}
        </p>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Бюджет: Закон за държавния бюджет (админ. единица „Министерство на транспорта и съобщенията“). Разбивката субсидия/издръжка не е в бюджетния разрез по политики — предстои (нужни са редът за ЗОП/ЗДБ и приходите на БДЖ)."
            : "Budget: State Budget Law (МТС admin unit). A subsidy/upkeep split is not in the node's by-policy breakdown — that tile is pending (needs the budget-law PSO row + БДЖ revenue)."}
        </p>
      </CardContent>
    </Card>
  );
};
