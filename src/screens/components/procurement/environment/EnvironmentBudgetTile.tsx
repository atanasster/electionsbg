// „Бюджетът на МОСВ" — the ministry-budget context tile. The МОСВ ministry budget has
// grown sharply (2018→2025) as the environmental-protection function scaled; this tile
// shows the enacted expenditure trend and names what it funds (air/water monitoring,
// waste policy, meteorology). The authoritative budget figure is the ЗДБ per-ministry
// node (expenditure.amountEur). Mirrors TransportBudgetTile.
//
// NB the ПУДООС fund grants and the ОП „Околна среда" EU money sit OUTSIDE this ministry
// line — the fund and the EU programmes are their own envelopes (see the EU-funds tile).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { useBudgetMinistryRollup } from "@/data/budget/useBudget";
import { MOSV_BUDGET_NODE } from "@/lib/environmentReferenceData";

export const EnvironmentBudgetTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data } = useBudgetMinistryRollup(MOSV_BUDGET_NODE);
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
    <Card id="environment-budget">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Landmark className="h-4 w-4" />
          {bg ? "Бюджетът на МОСВ" : "The МОСВ budget"}
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
              Бюджетът на министерството финансира политиките за{" "}
              <span className="font-semibold">
                опазване на компонентите на околната среда
              </span>
              , мониторинга на въздуха и водите (ИАОС) и метеорологията (НИМХ).
              Грантовете на ПУДООС и парите по ОП „Околна среда“ са отделни
              пера, извън този разход.
            </>
          ) : (
            <>
              The ministry budget funds the policies for{" "}
              <span className="font-semibold">
                protecting the environment's components
              </span>
              , air &amp; water monitoring (ИАОС) and meteorology (НИМХ). The
              ПУДООС fund grants and the ОП „Околна среда“ EU money are separate
              envelopes, outside this line.
            </>
          )}
        </p>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Източник: Закон за държавния бюджет (админ. единица „Министерство на околната среда и водите“), разход в евро."
            : "Source: State Budget Law (МОСВ admin unit), expenditure in EUR."}
        </p>
      </CardContent>
    </Card>
  );
};
