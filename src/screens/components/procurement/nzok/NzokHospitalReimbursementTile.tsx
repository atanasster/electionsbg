// "НЗОК плащания за болнична помощ" — shown on a hospital's own /company/:eik page.
// The mirror image of the procurement tiles on the same page: those show what the
// hospital SPENDS through ЗОП (money out), this shows what НЗОК PAYS it for
// inpatient care (money in) — the far larger flow, and one that never appears in
// the contract ledger. Fed by the Рег.№→EIK crosswalk (useNzokHospitalByEik); the
// tile renders nothing unless this EIK is a matched hospital, so it's safe to drop
// on every company page. One EIK can run several ЛЗ facilities (ВМА, Сърце и
// Мозък) — those are listed and summed.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { HeartPulse } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { useNzokHospitalByEik } from "@/data/budget/useBudget";
import { decodeEntities } from "@/lib/decodeEntities";

const MONTHS_BG = [
  "",
  "януари",
  "февруари",
  "март",
  "април",
  "май",
  "юни",
  "юли",
  "август",
  "септември",
  "октомври",
  "ноември",
  "декември",
];
const MONTHS_EN = [
  "",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const NzokHospitalReimbursementTile: FC<{ eik: string }> = ({ eik }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const { data } = useNzokHospitalByEik();
  const entry = data?.byEik[eik];
  if (!data || !entry || entry.totalCumulativeEur <= 0) return null;

  const period = bg
    ? `${MONTHS_BG[data.month] ?? ""} ${data.year}`.trim()
    : `${MONTHS_EN[data.month] ?? ""} ${data.year}`.trim();
  const facilities = [...entry.facilities].sort(
    (a, b) => b.cumulativeEur - a.cumulativeEur,
  );

  return (
    <Card className="border-rose-300/50 dark:border-rose-900/50">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <HeartPulse className="h-4 w-4 text-rose-600 dark:text-rose-400" />
          {bg
            ? "НЗОК плащания за болнична помощ"
            : "НЗОК inpatient-care reimbursement"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-2xl font-bold tabular-nums text-rose-700 dark:text-rose-400">
            {formatEurCompact(entry.totalCumulativeEur, i18n.language)}
          </span>
          <span className="text-sm text-muted-foreground">
            {bg
              ? `изплатени от НЗОК за болнична медицинска помощ (натрупано до ${period})`
              : `paid by НЗОК for inpatient care (cumulative to ${period})`}
          </span>
        </div>

        {facilities.length > 1 && (
          <ul className="divide-y text-xs">
            {facilities.map((f) => (
              <li
                key={f.regNo}
                className="flex items-center justify-between gap-2 py-1.5"
              >
                <span className="min-w-0 truncate text-muted-foreground">
                  {decodeEntities(f.name)}
                </span>
                <span className="shrink-0 tabular-nums">
                  {formatEurCompact(f.cumulativeEur, i18n.language)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `Източник: месечният отчет на НЗОК „Заплатени здравноосигурителни плащания за БМП по лечебни заведения". Плаща се извън обществените поръчки — за разлика от сумите по-долу, които тази болница ХАРЧИ по ЗОП.`
            : `Source: НЗОК's monthly hospital-care payments report. Paid outside public procurement — unlike the amounts below, which this hospital SPENDS through ЗОП.`}
        </p>
      </CardContent>
    </Card>
  );
};
