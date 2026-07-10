// "Финансово състояние" — a hospital's own quarterly financial + capacity
// indicators, on its /company/:eik page, under the НЗОК money-in tile.
//
// Source: МЗ's "Финансови показатели на лечебни заведения за болнична помощ",
// one workbook per quarter since 2019-Q2 under Наредба № 5 от 2019, derived from
// the ЕЕОФ returns hospitals file. This is everything BELOW the НЗОК payment
// line — revenue against expense, total and overdue liabilities, beds, occupancy,
// average length of stay.
//
// Cost per patient is printed, never RANKED. A specialised centre spends
// multiples of a general hospital's per-patient figure because of its case mix,
// so a percentile without a case-mix denominator would rank specialties, not
// stewardship. The denominator is the clinical-pathway corpus, which is not yet
// ingested; until it is, this number is descriptive and says so.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { useNzokFinancialsByEik } from "@/data/budget/useBudget";

// The source's `…Pct` columns are FRACTIONS in 0..1 (0.508 = 50.8%), despite the
// name. Format with a percent formatter — appending "%" to the raw value would
// print "0.5%" for a half-full hospital.
const pct = (v: number | null, lang: string) =>
  v == null
    ? "—"
    : new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB", {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(v);

const num = (v: number | null, lang: string, digits = 1) =>
  v == null
    ? "—"
    : new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB", {
        maximumFractionDigits: digits,
      }).format(v);

export const NzokFinancialHealthStrip: FC<{ eik: string }> = ({ eik }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const { data } = useNzokFinancialsByEik(eik);
  if (!data?.latest) return null;

  const f = data.latest;
  const result = f.revenueEur - f.expenseEur;
  const loss = result < 0;

  const cells: { label: string; value: string; muted?: boolean }[] = [
    {
      label: bg ? "Приходи" : "Revenue",
      value: formatEurCompact(f.revenueEur, i18n.language),
    },
    {
      label: bg ? "Разходи" : "Expense",
      value: formatEurCompact(f.expenseEur, i18n.language),
    },
    {
      label: bg ? "Общо задължения" : "Total liabilities",
      value: formatEurCompact(f.totalLiabilitiesEur, i18n.language),
    },
    {
      label: bg ? "Просрочени задължения" : "Overdue liabilities",
      value: formatEurCompact(f.overdueLiabilitiesEur, i18n.language),
    },
    {
      label: bg ? "Използваемост на леглата" : "Bed occupancy",
      value: pct(f.bedOccupancyPct, i18n.language),
    },
    {
      label: bg ? "Просрочени / приходи" : "Overdue / revenue",
      value: pct(f.overdueLiabilitiesRevenueSharePct, i18n.language),
    },
    {
      label: bg ? "Среден престой (дни)" : "Avg length of stay (days)",
      value: num(f.avgLengthOfStay, i18n.language),
    },
    {
      label: bg ? "Преминали болни" : "Patients treated",
      value: num(f.patientsTreated, i18n.language, 0),
    },
    {
      label: bg ? "Разход на преминал болен" : "Cost per patient",
      value:
        f.costPerPatientEur == null
          ? "—"
          : formatEurCompact(f.costPerPatientEur, i18n.language),
      muted: true,
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Landmark className="h-4 w-4 text-slate-600 dark:text-slate-400" />
          {bg ? "Финансово състояние" : "Financial condition"}
          <span className="text-xs font-normal text-muted-foreground">
            {f.quarter}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-3 md:p-4">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span
            className={`text-2xl font-bold tabular-nums ${
              loss
                ? "text-rose-700 dark:text-rose-400"
                : "text-emerald-700 dark:text-emerald-400"
            }`}
          >
            {loss ? "−" : "+"}
            {formatEurCompact(Math.abs(result), i18n.language)}
          </span>
          <span className="text-sm text-muted-foreground">
            {loss
              ? bg
                ? "загуба за тримесечието"
                : "loss for the quarter"
              : bg
                ? "печалба за тримесечието"
                : "profit for the quarter"}
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-1 text-xs sm:grid-cols-4">
          {cells.map((c) => (
            <div key={c.label} className="rounded border px-2 py-1.5">
              <dt className="truncate text-muted-foreground">{c.label}</dt>
              <dd
                className={`tabular-nums font-medium ${c.muted ? "text-muted-foreground" : ""}`}
              >
                {c.value}
              </dd>
            </div>
          ))}
        </dl>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `Източник: „Финансови показатели на лечебни заведения за болнична помощ" на Министерство на здравеопазването (Наредба № 5 от 2019 г.), тримесечно от 2019 г. Разходът на преминал болен е описателен и НЕ се класира: специализираните центрове поемат по-тежки случаи, така че сравнение без отчитане на структурата на случаите би класирало специалността, а не стопанисването. Данни за ${data.series.length} тримесечия.`
            : `Source: the Ministry of Health's quarterly "Financial indicators of inpatient-care providers" (Наредба № 5/2019), from 2019. Cost per patient is descriptive and is NOT ranked: specialised centres take heavier cases, so comparing without a case-mix denominator would rank the specialty, not the stewardship. ${data.series.length} quarters of data.`}
        </p>
      </CardContent>
    </Card>
  );
};
