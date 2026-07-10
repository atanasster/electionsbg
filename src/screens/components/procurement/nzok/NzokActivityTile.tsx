// "Дейности по НЗОК" — the clinical-activity corpus on the health pack
// (/awarder/121858220): what НЗОК actually pays hospitals to DO, in cases.
//
// НЗОК publishes, monthly, the number of cases and insured persons (ЗОЛ) per
// clinical pathway (КП) / ambulatory procedure (АПр) / clinical procedure (КПр)
// per hospital. This is the CASE-MIX DENOMINATOR the rest of the pack lacked —
// "€X per patient" means nothing without knowing which patients. It also lets us
// flag, WITHOUT any black-box model, a hospital reporting far more cases per bed
// on ONE pathway than its same-type peers on the SAME pathway.
//
// What it does NOT claim: the source carries the procedure CODE only (no name, no
// НРД price), so there is no lev/euro value here — only volume. And a high
// cases-per-bed ratio is a SIGNPOST, not a verdict: day-case pathways, referral
// concentration and bed accounting all move it legitimately. The floors printed
// below (min cases, min beds, min peers) keep thin, meaningless cells out.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Activity, BedDouble } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import {
  useNzokActivities,
  useNzokProcedureNames,
} from "@/data/budget/useBudget";
import { resolveProcedureName } from "@/lib/nzokProcedures";
import { FacilityLink } from "./FacilityLink";

const nf = (n: number, lang: string) =>
  n.toLocaleString(lang === "bg" ? "bg" : "en");

// The three НЗОК activity kinds, derived upstream from the procedure code's first
// letter (P→КП, A→АПр, K→КПр). The source ships only the abbreviation, which a
// non-specialist can't decode, so we spell it out in the table.
const PROC_TYPE_LABEL: Record<string, { bg: string; en: string }> = {
  КП: { bg: "Клинична пътека", en: "Clinical pathway" },
  АПр: { bg: "Амбулаторна процедура", en: "Ambulatory procedure" },
  КПр: { bg: "Клинична процедура", en: "Clinical procedure" },
};
const procTypeLabel = (t: string, bg: boolean): string => {
  const l = PROC_TYPE_LABEL[t];
  return l ? (bg ? l.bg : l.en) : t;
};

export const NzokActivityTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data } = useNzokActivities();
  const { data: procNames } = useNzokProcedureNames();
  if (!data || !data.topProcedures?.length) return null;

  const procs = data.topProcedures.slice(0, 12);
  const outliers = (data.caseBedOutliers ?? []).slice(0, 10);
  const f = data.caseBedFloors;

  // Two standalone tiles side by side on desktop: the national top-procedures
  // volume table, and the pathway-internal cases-per-bed outliers.
  return (
    <div className="grid items-start gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            {bg
              ? "Най-чести процедури (по случаи)"
              : "Most frequent procedures (by cases)"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-3 md:p-4">
          <p className="text-xs text-muted-foreground">
            {bg
              ? `За ${data.year} г. НЗОК заплати ${nf(data.totalCases, lang)} случая по ${nf(data.distinctProcedures, lang)} процедури в ${nf(data.distinctFacilities, lang)} лечебни заведения — включително частните болници. Това е знаменателят „на пациент", който липсва в отчетите за разходи.`
              : `In ${data.year} НЗОК paid for ${nf(data.totalCases, lang)} cases across ${nf(data.distinctProcedures, lang)} procedures in ${nf(data.distinctFacilities, lang)} facilities — private hospitals included. This is the per-patient denominator the spending reports lack.`}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th
                    className="py-1.5 pr-2 text-left font-normal"
                    title={
                      bg
                        ? "Наименование по НРД (Приложение 17–19). Отчетът за дейността носи само кода — името се добавя от номенклатурата на НЗОК."
                        : "НРД name (Appendix 17–19). The activity report carries only the code; the name is joined from НЗОК's nomenclature."
                    }
                  >
                    {bg ? "Процедура" : "Procedure"}
                  </th>
                  <th className="py-1.5 pr-2 text-left font-normal">
                    {bg ? "Вид" : "Type"}
                  </th>
                  <th className="py-1.5 pr-2 text-right font-normal">
                    {bg ? "Случаи" : "Cases"}
                  </th>
                  <th className="py-1.5 text-right font-normal">
                    {bg ? "Болници" : "Facilities"}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {procs.map((p) => {
                  const name = resolveProcedureName(procNames, p.procedure);
                  return (
                    <tr key={p.procedure}>
                      <td className="py-1.5 pr-2">
                        {name ? (
                          <>
                            <span
                              className="block max-w-[22rem] truncate"
                              title={name}
                            >
                              {name}
                            </span>
                            <span className="text-[10px] tabular-nums text-muted-foreground">
                              {p.procedure}
                            </span>
                          </>
                        ) : (
                          <span className="font-medium tabular-nums">
                            {p.procedure}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-2 text-muted-foreground">
                        {procTypeLabel(p.procType, bg)}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {nf(p.cases, lang)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                        {p.facilityCount}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Cases-per-bed outliers — its own tile. */}
      {outliers.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <BedDouble className="h-4 w-4 text-muted-foreground" />
              {bg
                ? "Случаи на легло — над сходните болници"
                : "Cases per bed — above same-type peers"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-3 md:p-4">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-1.5 pr-2 text-left font-normal">
                      {bg ? "Болница" : "Hospital"}
                    </th>
                    <th className="py-1.5 pr-2 text-left font-normal">
                      {bg ? "Процедура" : "Procedure"}
                    </th>
                    <th className="py-1.5 pr-2 text-right font-normal">
                      {bg ? "Случаи/легло" : "Cases/bed"}
                    </th>
                    <th className="py-1.5 pr-2 text-right font-normal">
                      {bg ? "Медиана" : "Peer median"}
                    </th>
                    <th className="py-1.5 text-right font-normal">×</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {outliers.map((o, i) => {
                    const name = resolveProcedureName(procNames, o.procedure);
                    return (
                      <tr key={`${o.facility}|${o.procedure}|${i}`}>
                        <td className="max-w-[13rem] truncate py-1.5 pr-2">
                          <FacilityLink eik={o.eik} name={o.facility} />
                          <span className="block text-[10px] text-muted-foreground">
                            {o.hospitalType}
                          </span>
                        </td>
                        <td className="max-w-[13rem] py-1.5 pr-2">
                          {name && (
                            <span className="block truncate" title={name}>
                              {name}
                            </span>
                          )}
                          <span className="tabular-nums text-muted-foreground">
                            {o.procedure}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {" · "}
                            {procTypeLabel(o.procType, bg)}
                          </span>
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">
                          {o.casesPerBed.toFixed(1)}
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">
                          {o.peerMedian.toFixed(1)}
                        </td>
                        <td className="py-1.5 text-right font-medium tabular-nums">
                          {o.ratio.toFixed(1)}×
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground/80">
              {bg
                ? `„Случаи на легло" сравнява само болници от един и същи тип (УМБАЛ с УМБАЛ) по една и съща процедура; включени са редове с поне ${f.minCases} случая, ${f.minBeds} легла и ${f.minPeers} сходни болници. По-високата стойност НЕ е нередност — може да отразява дневен стационар, преференциално насочване или отчитане на леглата. Броят случаи е обем, не стойност: източникът съдържа само кода на процедурата, без цена по НРД. Източник: НЗОК, месечни отчети за дейността.`
                : `"Cases per bed" compares only same-type hospitals (УМБАЛ vs УМБАЛ) on the same procedure; rows need at least ${f.minCases} cases, ${f.minBeds} beds and ${f.minPeers} peers. A higher value is NOT an irregularity — it can reflect day-case pathways, referral concentration or bed accounting. Cases are volume, not value: the source carries the procedure code only, no НРД price. Source: НЗОК monthly activity reports.`}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
