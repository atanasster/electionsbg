// Per-procedure (clinical pathway / ambulatory / clinical procedure) page
// (/procedure/:code). One НЗОК pathway across every hospital: the national case
// volume НЗОК paid it for in the latest full year, the implied НРД-tariff value
// (when tariffs are loaded), and the hospitals billing it ranked by cases — the
// NHSU "who delivers this service package" view, applied to Bulgaria's
// pathway-based payment model. It is the inverse of a hospital's own case-mix.
//
// VOLUME, NOT SPEND. The activity corpus carries case counts only — spend is
// cases × the НРД list tariff, not necessarily the amount paid, and is null until
// tariffs load. A high count is scale, not an irregularity.

import { FC } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Activity, Users, Building2, Coins, Network } from "lucide-react";
import { Title } from "@/ux/Title";
import { StatCard } from "@/screens/dashboard/StatCard";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import {
  useNzokActivityByProcedure,
  useNzokProcedureNames,
} from "@/data/budget/useBudget";
import { resolveProcedureName, procTypeLabel } from "@/lib/nzokProcedures";
import { formatEur, formatEurCompact } from "@/lib/currency";
import { FacilityLink } from "@/screens/components/procurement/nzok/FacilityLink";

const NZOK_EIK = "121858220";

export const ProcedureDetailScreen: FC = () => {
  const { code: codeParam } = useParams<{ code: string }>();
  const code = codeParam ?? "";
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const L = i18n.language;
  const { data } = useNzokActivityByProcedure(code || null);
  const { data: names } = useNzokProcedureNames();
  const name = resolveProcedureName(names, code);

  const nf = new Intl.NumberFormat(bg ? "bg-BG" : "en-US");

  return (
    <>
      <Title
        description={
          bg
            ? `Клиничен показател ${code}${name ? ` — ${name}` : ""}: колко случая заплати НЗОК за ${data?.year ?? ""} г. и кои лечебни заведения ги отчитат, подредени по обем. Броят е обем, не непременно платена сума.`
            : `Clinical item ${code}${name ? ` — ${name}` : ""}: how many cases НЗОК paid for in ${data?.year ?? ""} and which facilities bill it, ranked by volume. Case counts are volume, not necessarily the amount paid.`
        }
      >
        <span className="block">{name || code}</span>
        {name && (
          <span className="block text-base font-normal text-muted-foreground tabular-nums">
            {code}
            {data ? ` · ${procTypeLabel(data.procType, bg)}` : ""}
          </span>
        )}
      </Title>

      {!data ? (
        <p className="my-8 text-center text-muted-foreground">
          {bg
            ? "Няма данни за дейност по този показател."
            : "No activity data for this item."}
        </p>
      ) : (
        <section aria-label={code} className="my-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={bg ? "Случаи" : "Cases"}>
              <div className="flex items-baseline gap-2">
                <Activity className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="text-2xl font-bold tabular-nums">
                  {nf.format(data.totalCases)}
                </span>
              </div>
              <span className="mt-1 block text-xs text-muted-foreground">
                {bg ? `през ${data.year} г.` : `in ${data.year}`}
              </span>
            </StatCard>
            <StatCard label={bg ? "Лечебни заведения" : "Facilities"}>
              <div className="flex items-baseline gap-2">
                <Building2 className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="text-2xl font-bold tabular-nums">
                  {data.facilityCount}
                </span>
              </div>
            </StatCard>
            {data.totalZol != null && (
              <StatCard label={bg ? "ЗОЛ (сумарно)" : "Insured (summed)"}>
                <div className="flex items-baseline gap-2">
                  <Users className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <span className="text-2xl font-bold tabular-nums">
                    {nf.format(data.totalZol)}
                  </span>
                </div>
              </StatCard>
            )}
            {data.totalSpendEur != null && (
              <StatCard label={bg ? "Стойност по НРД" : "Value at НРД tariff"}>
                <div className="flex items-baseline gap-2">
                  <Coins className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <span className="text-2xl font-bold tabular-nums">
                    {formatEurCompact(data.totalSpendEur, L)}
                  </span>
                </div>
                {data.priceEur != null && (
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {formatEur(data.priceEur, L, { decimals: 0 })}{" "}
                    {bg ? "на случай" : "per case"}
                  </span>
                )}
              </StatCard>
            )}
          </div>

          <DashboardSection
            id="procedure-hospitals"
            title={bg ? "Кой отчита този показател" : "Who bills this item"}
            icon={Network}
          >
            <div className="rounded-xl border bg-card p-3 shadow-sm md:p-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-1.5 pr-2 text-left font-normal">
                        {bg ? "Лечебно заведение" : "Facility"}
                      </th>
                      <th className="py-1.5 pr-2 text-right font-normal">
                        {bg ? "Случаи" : "Cases"}
                      </th>
                      {data.totalSpendEur != null && (
                        <th className="py-1.5 pr-2 text-right font-normal">
                          {bg ? "Стойност" : "Value"}
                        </th>
                      )}
                      <th className="py-1.5 text-right font-normal">
                        {bg ? "Дял" : "Share"}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.hospitals.map((h) => (
                      <tr
                        key={(h.eik ?? h.facility) + h.rzok}
                        className="hover:bg-muted/40"
                      >
                        <td className="py-1.5 pr-2">
                          <FacilityLink eik={h.eik} name={h.facility} />
                          <span className="ml-1 text-[10px] text-muted-foreground">
                            {h.rzok}
                          </span>
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums font-medium">
                          {nf.format(h.cases)}
                        </td>
                        {data.totalSpendEur != null && (
                          <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">
                            {h.spendEur != null
                              ? formatEurCompact(h.spendEur, L)
                              : "—"}
                          </td>
                        )}
                        <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                          {h.sharePct != null ? `${h.sharePct}%` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </DashboardSection>

          <p className="mt-6 text-[11px] text-muted-foreground/80">
            {data.totalSpendEur != null
              ? bg
                ? `Стойността е случаи × цена по НРД (лимитна стойност), не непременно платената сума. ЗОЛ сумира месечните броеве и е груб мащаб, не брой различни пациенти. Източник: НЗОК „Брой случаи и брой ЗОЛ по КП/АПр/КПр“ + цени по НРД, ${data.year} г.`
                : `Value is cases × the НРД list price (limit value), not necessarily the amount paid. ЗОЛ sums monthly counts — a rough scale, not a distinct-patient count. Source: НЗОК cases-by-pathway + НРД tariffs, ${data.year}.`
              : bg
                ? `Броят на случаите е обем, не стойност — източникът съдържа само кода на показателя, без цена по НРД. ЗОЛ сумира месечните броеве и е груб мащаб, не брой различни пациенти. Източник: НЗОК, „Брой случаи и брой ЗОЛ по КП/АПр/КПр“, ${data.year} г.`
                : `Case counts are volume, not value — the source carries the item code only, no НРД price. ЗОЛ sums monthly counts — a rough scale, not a distinct-patient count. Source: НЗОК, “cases & insured persons by pathway”, ${data.year}.`}
          </p>

          <p className="mt-4 text-center text-sm">
            <Link
              to={`/awarder/${NZOK_EIK}`}
              className="text-primary hover:underline"
            >
              ← {bg ? "НЗОК — здравен пакет" : "NHIF — health pack"}
            </Link>
          </p>
        </section>
      )}
    </>
  );
};
