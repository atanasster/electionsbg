// Per-molecule (INN) page (/molecule/:inn), in TWO TIERS.
//
// SPEND (every reimbursed INN, all 610): what НЗОК paid for this active
// substance, quarter by quarter. This is the tier that makes the page servable —
// it used to key entirely on the overpay analysis below, which exists for ~30
// molecules, so 580 of 610 rendered the not-found branch. Invisible while
// nothing linked here; the sector search box makes it the common path.
//
// ABOVE-MEDIAN (~30): the euros paid above the peer median for this molecule's
// packs in the latest full year, the pack-identity breakdown (the comparison
// NEVER drifts to molecule level — one INN ships in packs whose unit prices are
// not comparable), and every hospital that paid above median, each linking to
// its own /company/:eik profile. Its ABSENCE is the normal case, not an error.
//
// As across the whole НЗОК pack: a price gap is a SIGNPOST, not an irregularity —
// volume, delivery period and contract terms all legitimately move a unit price.

import { FC } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Pill, Coins, Building2, TrendingUp } from "lucide-react";
import { Title } from "@/ux/Title";
import { StatCard } from "@/screens/dashboard/StatCard";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { useNzokDrugMolecule } from "@/data/budget/useBudget";
import { formatEur, formatEurCompact } from "@/lib/currency";
import { decodeEntities } from "@/lib/decodeEntities";
import { FacilityLink } from "@/screens/components/procurement/nzok/FacilityLink";
import { packHref } from "@/screens/components/procurement/nzok/drugLinks";

const NZOK_EIK = "121858220";

export const MoleculeDetailScreen: FC = () => {
  const { inn: innParam } = useParams<{ inn: string }>();
  const inn = (innParam ?? "").toUpperCase();
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const L = i18n.language;
  const { data, isLoading } = useNzokDrugMolecule(inn);
  const spend = data?.spend ?? null;
  const over = data?.overpay ?? null;

  return (
    <>
      <Title
        description={
          bg
            ? `Молекулата ${inn} — колко реимбурсира НЗОК по тримесечия и (когато има такива данни) кои болници са платили над медианната цена за същата опаковка.`
            : `The molecule ${inn} — what NHIF reimbursed quarter by quarter and, where such data exists, which hospitals paid above the peer median for the same pack.`
        }
      >
        <span className="uppercase">{inn}</span>
      </Title>

      {isLoading ? (
        <div className="my-6 h-40 animate-pulse rounded-xl border bg-card" />
      ) : !data ? (
        <p className="my-8 text-center text-muted-foreground">
          {bg
            ? "Няма данни за тази молекула в реимбурсния регистър на НЗОК."
            : "No data for this molecule in the NHIF reimbursement register."}
        </p>
      ) : (
        <section aria-label={inn} className="my-4">
          {(spend || over) && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {spend && (
                <StatCard label={bg ? "Реимбурсирано" : "Reimbursed"}>
                  <div className="flex items-baseline gap-2">
                    <Coins className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <span className="text-2xl font-bold tabular-nums">
                      {formatEurCompact(spend.totalEur, L)}
                    </span>
                  </div>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {spend.series.length > 0
                      ? `${spend.series[0].quarter} — ${spend.series[spend.series.length - 1].quarter}`
                      : ""}
                  </span>
                </StatCard>
              )}
              {spend && (
                <StatCard label="ATC">
                  <div className="flex items-baseline gap-2">
                    <Pill className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <span className="text-2xl font-bold tabular-nums">
                      {spend.atc ?? "—"}
                    </span>
                  </div>
                </StatCard>
              )}
              {over && (
                <>
                  <StatCard label={bg ? "Над медианата" : "Above median"}>
                    <div className="flex items-baseline gap-2">
                      <TrendingUp className="h-5 w-5 shrink-0 text-muted-foreground" />
                      <span className="text-2xl font-bold tabular-nums">
                        {formatEurCompact(over.overpayEur, L)}
                      </span>
                    </div>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {bg ? `през ${over.year} г.` : `in ${over.year}`}
                    </span>
                  </StatCard>
                  <StatCard label={bg ? "Болници" : "Hospitals"}>
                    <div className="flex items-baseline gap-2">
                      <Building2 className="h-5 w-5 shrink-0 text-muted-foreground" />
                      <span className="text-2xl font-bold tabular-nums">
                        {over.facilityCount}
                      </span>
                    </div>
                  </StatCard>
                </>
              )}
            </div>
          )}

          {/* The quarterly spend series — the tier every reimbursed molecule
              has. A plain table rather than a chart: a handful of quarters
              reads better as numbers, and it keeps recharts off this route. */}
          {spend && spend.series.length > 0 && (
            <DashboardSection
              id="molecule-spend"
              title={
                bg ? "Реимбурсирано по тримесечия" : "Reimbursed by quarter"
              }
              icon={Coins}
            >
              <div className="rounded-xl border bg-card p-3 shadow-sm md:p-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-muted-foreground">
                      <tr className="border-b">
                        <th className="py-1.5 pr-2 text-left font-normal">
                          {bg ? "Тримесечие" : "Quarter"}
                        </th>
                        <th className="py-1.5 text-right font-normal">
                          {bg ? "Реимбурсирано" : "Reimbursed"}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {spend.series.map((q) => (
                        <tr key={q.quarter} className="hover:bg-muted/40">
                          <td className="py-1.5 pr-2">
                            {q.quarter.replace("-", " ")}
                          </td>
                          <td className="py-1.5 text-right tabular-nums">
                            {formatEur(q.eur, L)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </DashboardSection>
          )}

          {/* Everything below is the above-median analysis, which most
              molecules do not have. Say so rather than rendering empty tables. */}
          {!over && (
            <p className="my-6 rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
              {bg
                ? "За тази молекула няма отчетени цени над медианата за най-новата пълна година — това е обичайното положение, не липса на данни."
                : "This molecule has no above-median prices reported for the latest full year — the normal case, not missing data."}
            </p>
          )}

          {over && (
            <>
              <DashboardSection
                id="molecule-packs"
                title={bg ? "Опаковки" : "Packs"}
                icon={Pill}
              >
                <div className="rounded-xl border bg-card p-3 shadow-sm md:p-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-muted-foreground">
                        <tr className="border-b">
                          <th className="py-1.5 pr-2 text-left font-normal">
                            {bg ? "Опаковка" : "Pack"}
                          </th>
                          <th className="py-1.5 pr-2 text-right font-normal">
                            {bg ? "Медиана/ед." : "Median/unit"}
                          </th>
                          <th className="py-1.5 pr-2 text-right font-normal">
                            {bg ? "Болници" : "Hospitals"}
                          </th>
                          <th className="py-1.5 pr-2 text-right font-normal">
                            {bg ? "Над мед." : "Above"}
                          </th>
                          <th className="py-1.5 text-right font-normal">
                            {bg ? "Макс." : "Max"}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {over.packs.map((p) => (
                          <tr
                            key={`${p.nzokCode}|${p.nationalNo}`}
                            className="hover:bg-muted/40"
                          >
                            <td className="py-1.5 pr-2">
                              <Link
                                to={packHref(inn, p.nationalNo, p.nzokCode)}
                                className="text-accent hover:underline"
                              >
                                <span className="font-medium">
                                  {decodeEntities(p.tradeName) || p.nzokCode}
                                </span>
                                <span className="ml-1 text-muted-foreground">
                                  {p.nationalNo || p.nzokCode}
                                </span>
                              </Link>
                            </td>
                            <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">
                              {formatEur(p.medianUnitEur, L, { decimals: 2 })}
                            </td>
                            <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">
                              {p.facilityCount}
                            </td>
                            <td className="py-1.5 pr-2 text-right tabular-nums font-medium">
                              +{formatEurCompact(p.overpayEur, L)}
                            </td>
                            <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                              {p.maxRatio != null
                                ? `${p.maxRatio.toFixed(1)}×`
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </DashboardSection>

              <DashboardSection
                id="molecule-hospitals"
                title={bg ? "Болници над медианата" : "Hospitals above median"}
                icon={Building2}
              >
                <div className="rounded-xl border bg-card p-3 shadow-sm md:p-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-muted-foreground">
                        <tr className="border-b">
                          <th className="py-1.5 pr-2 text-left font-normal">
                            {bg ? "Болница" : "Hospital"}
                          </th>
                          <th className="py-1.5 pr-2 text-left font-normal">
                            {bg ? "Опаковка" : "Pack"}
                          </th>
                          <th className="py-1.5 pr-2 text-right font-normal">
                            {bg ? "Цена/ед." : "Unit"}
                          </th>
                          <th className="py-1.5 pr-2 text-right font-normal">
                            {bg ? "Медиана" : "Median"}
                          </th>
                          <th className="py-1.5 text-right font-normal">
                            {bg ? "Разлика" : "Gap"}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {over.rows.map((r, i) => (
                          <tr
                            key={`${r.regNo}|${r.nationalNo}|${r.nzokCode}|${i}`}
                            className="hover:bg-muted/40"
                          >
                            <td className="max-w-[16rem] truncate py-1.5 pr-2">
                              <FacilityLink eik={r.eik} name={r.facility} />
                            </td>
                            <td className="py-1.5 pr-2 text-muted-foreground">
                              <Link
                                to={packHref(inn, r.nationalNo, r.nzokCode)}
                                className="hover:underline"
                              >
                                {decodeEntities(r.tradeName) ||
                                  r.nationalNo ||
                                  r.nzokCode}
                              </Link>
                            </td>
                            <td className="py-1.5 pr-2 text-right tabular-nums">
                              {formatEur(r.unitEur, L, { decimals: 2 })}
                            </td>
                            <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">
                              {formatEur(r.medianUnitEur, L, { decimals: 2 })}
                            </td>
                            <td className="py-1.5 text-right tabular-nums font-medium">
                              {r.ratio.toFixed(1)}×
                              <span className="block text-[10px] font-normal text-muted-foreground">
                                +{formatEurCompact(r.overpayEur, L)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </DashboardSection>
            </>
          )}

          {over && (
            <p className="mt-6 text-[11px] text-muted-foreground/80">
              {bg
                ? `Сравнението е по конкретна опаковка (Национален №), не по молекула — една и съща молекула се предлага в опаковки с различен размер, чиито единични цени не са съпоставими. Ценовата разлика НЕ е нередност — може да отразява обем, срок на доставка или условия по договора. Отворете отделна опаковка, за да видите движението на цената по месеци. Източник: НЗОК „Справка 5" (Наредба 10/2009), ${over.year} г.`
                : `Compared at pack identity (Национален №), not molecule — the same molecule ships in packs whose unit prices are not comparable. A price gap is NOT an irregularity — it can reflect volume, delivery period or contract terms. Open a pack for its month-by-month price trend. Source: NHIF "Справка 5" (Наредба 10/2009), ${over.year}.`}
            </p>
          )}

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
