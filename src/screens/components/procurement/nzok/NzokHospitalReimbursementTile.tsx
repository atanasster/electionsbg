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
import {
  useNzokHospitalByEik,
  useNzokHospitalMomentumByEik,
} from "@/data/budget/useBudget";
import { decodeEntities } from "@/lib/decodeEntities";
import { monthYearLabel } from "@/lib/monthNames";
import { NzokPeerGrowthStrip } from "./NzokPeerGrowthStrip";

export const NzokHospitalReimbursementTile: FC<{ eik: string }> = ({ eik }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const { data: entry } = useNzokHospitalByEik(eik);
  const { data: momentum } = useNzokHospitalMomentumByEik(eik);
  if (!entry || entry.totalCumulativeEur <= 0) return null;

  // asOf is the report month-end ("2026-05-31"); derive the period label from it.
  const month = Number(entry.asOf.slice(5, 7));
  const year = Number(entry.asOf.slice(0, 4));
  const period = monthYearLabel(month, year, i18n.language);
  // Already ordered by the DB function (cumulative desc, reg_no tiebreak).
  const facilities = entry.facilities;

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
              ? `изплатени от НЗОК (натрупано до ${period})`
              : `paid by НЗОК (cumulative to ${period})`}
          </span>
        </div>

        {/* The three streams НЗОК pays a hospital through. Shown as a split rather
            than one figure because the headline used to BE the БМП stream alone,
            which understated every facility by its drugs + devices money — see
            migration 050. */}
        <ul className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-3">
          {(
            [
              ["bmpEur", bg ? "Болнична помощ" : "Inpatient care"],
              ["drugsEur", bg ? "Лекарства" : "Drugs"],
              ["devicesEur", bg ? "Медицински изделия" : "Medical devices"],
            ] as const
          ).map(([key, label]) => (
            <li
              key={key}
              className="flex items-baseline justify-between gap-2 rounded border px-2 py-1.5"
            >
              <span className="min-w-0 truncate text-muted-foreground">
                {label}
              </span>
              <span className="shrink-0 font-medium tabular-nums">
                {formatEurCompact(entry[key] ?? 0, i18n.language)}
              </span>
            </li>
          ))}
        </ul>

        {/* Transparent peer-comparison — where this hospital's YoY spend growth
            sits in the national distribution (published formula, not a black box).
            Pinned to the БМП stream (migration 050): the drugs/devices series is
            shorter, so a three-stream YoY would compare unlike years. */}
        {momentum && <NzokPeerGrowthStrip m={momentum} />}

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
            ? `Източник: трите месечни отчета на НЗОК по лечебни заведения — за БМП, за лекарствени продукти и за медицински изделия. Плаща се извън обществените поръчки — за разлика от сумите по-долу, които тази болница ХАРЧИ по ЗОП. Отчетите излизат по различен график, затова последният месец на трите потока може да се различава.`
            : `Source: НЗОК's three monthly per-hospital reports — inpatient care, drugs applied in hospital, and medical devices. Paid outside public procurement, unlike the amounts below, which this hospital SPENDS through ЗОП. The three reports are published on their own cadences, so their latest month can differ.`}
        </p>
      </CardContent>
    </Card>
  );
};
