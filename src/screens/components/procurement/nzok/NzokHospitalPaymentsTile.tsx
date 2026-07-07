// "Плащания към болниците" — the real money. Hospital care (болнична
// медицинска помощ) is НЗОК's single largest budget line (~€2.36bn/yr) and it is
// paid OUTSIDE public procurement, so it never appears in the contract ledger
// above. This tile surfaces it from НЗОК's own monthly per-facility report: the
// national YTD total, the top-paid hospitals, and the per-РЗОК split. Rows are
// name-keyed for now (the ИАМН рег.№→EIK crosswalk that would link each hospital
// to its own page is a later phase). Pure from NzokHospitalPaymentsFile.

import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { Building2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import type { NzokHospitalPaymentsFile } from "@/data/budget/types";

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

const TOP_N = 12;

export const NzokHospitalPaymentsTile: FC<{
  data: NzokHospitalPaymentsFile;
}> = ({ data }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const eur = (v: number) => formatEurCompact(v, lang);
  const [view, setView] = useState<"hospitals" | "rzok">("hospitals");

  const total = data.totalCumulativeEur;
  if (total <= 0 || !data.hospitals.length) return null;
  const period = bg
    ? `${MONTHS_BG[data.month] ?? ""} ${data.year}`.trim()
    : `${MONTHS_EN[data.month] ?? ""} ${data.year}`.trim();

  const rows =
    view === "hospitals"
      ? data.hospitals.slice(0, TOP_N).map((h) => ({
          key: h.regNo,
          label: h.name,
          sub: h.rzokName,
          value: h.cumulativeEur,
        }))
      : data.byRzok.map((r) => ({
          key: r.code,
          label: r.name,
          sub: `${r.facilityCount} ${bg ? "заведения" : "facilities"}`,
          value: r.cumulativeEur,
        }));
  const max = Math.max(...rows.map((r) => r.value));

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            {bg ? "Плащания към болниците" : "Payments to hospitals"}
          </CardTitle>
          <div className="flex gap-1" role="group">
            {(["hospitals", "rzok"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`rounded-full border px-2 py-0.5 text-xs font-medium transition-colors ${
                  v === view
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground hover:text-foreground"
                }`}
              >
                {v === "hospitals"
                  ? bg
                    ? "Болници"
                    : "Hospitals"
                  : bg
                    ? "По РЗОК"
                    : "By region"}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        {/* National headline */}
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-2xl font-bold tabular-nums">{eur(total)}</span>
          <span className="text-sm text-muted-foreground">
            {bg
              ? `изплатени на ${data.facilityCount} лечебни заведения за болнична помощ (натрупано до ${period})`
              : `paid to ${data.facilityCount} hospitals for inpatient care (cumulative to ${period})`}
          </span>
        </div>

        {/* Ranked list */}
        <div className="space-y-2">
          {rows.map((r) => {
            const share = r.value / total;
            return (
              <div key={r.key} className="text-xs">
                <div className="flex items-baseline justify-between gap-2 mb-0.5">
                  <span className="min-w-0 truncate font-medium">
                    {r.label}
                  </span>
                  <span className="tabular-nums text-muted-foreground shrink-0">
                    {eur(r.value)}
                    <span className="ml-1 text-muted-foreground/70">
                      {(share * 100).toLocaleString(lang, {
                        maximumFractionDigits: 1,
                      })}
                      %
                    </span>
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }}
                  />
                </div>
                {view === "hospitals" && r.sub && (
                  <div className="mt-0.5 text-[11px] text-muted-foreground/70">
                    {r.sub}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `Източник: месечният отчет на НЗОК „Заплатени здравноосигурителни плащания за БМП по лечебни заведения". Сумите са кумулативни от началото на ${data.year} г. и се плащат извън обществените поръчки.`
            : `Source: НЗОК's monthly "hospital-care payments by facility" report. Figures are cumulative from the start of ${data.year} and are paid outside public procurement.`}
        </p>
      </CardContent>
    </Card>
  );
};
