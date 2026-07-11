// Per-molecule (INN) page (/molecule/:inn). One active substance across every
// hospital: the euros paid ABOVE the peer median for its packs in the latest full
// year, the pack-identity breakdown (the comparison NEVER drifts to molecule
// level — one INN ships in packs whose unit prices are not comparable), and every
// hospital that paid above median, each linking to its own /company/:eik profile.
//
// As across the whole НЗОК pack: a price gap is a SIGNPOST, not an irregularity —
// volume, delivery period and contract terms all legitimately move a unit price.

import { FC } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Pill, Coins, Package, Building2, TrendingUp } from "lucide-react";
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

  return (
    <>
      <Title
        description={
          bg
            ? `Цени по болници за молекулата ${inn} — колко са платили лечебните заведения над медианната цена за същата опаковка (НЗОК „Справка 5").`
            : `Hospital unit prices for the molecule ${inn} — how much facilities paid above the peer median for the same pack (NHIF "Справка 5").`
        }
      >
        <span className="uppercase">{inn}</span>
      </Title>

      {isLoading ? (
        <div className="my-6 h-40 animate-pulse rounded-xl border bg-card" />
      ) : !data ? (
        <p className="my-8 text-center text-muted-foreground">
          {bg
            ? "Няма данни за отклонения над медианата за тази молекула."
            : "No above-median pricing data for this molecule."}
        </p>
      ) : (
        <section aria-label={inn} className="my-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={bg ? "Над медианата" : "Above median"}>
              <div className="flex items-baseline gap-2">
                <Coins className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="text-2xl font-bold tabular-nums">
                  {formatEurCompact(data.overpayEur, L)}
                </span>
              </div>
              <span className="mt-1 block text-xs text-muted-foreground">
                {bg ? `през ${data.year} г.` : `in ${data.year}`}
              </span>
            </StatCard>
            <StatCard label={bg ? "Опаковки" : "Packs"}>
              <div className="flex items-baseline gap-2">
                <Package className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="text-2xl font-bold tabular-nums">
                  {data.packCount}
                </span>
              </div>
            </StatCard>
            <StatCard label={bg ? "Болници" : "Hospitals"}>
              <div className="flex items-baseline gap-2">
                <Building2 className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="text-2xl font-bold tabular-nums">
                  {data.facilityCount}
                </span>
              </div>
            </StatCard>
            <StatCard label={bg ? "Макс. отклонение" : "Max deviation"}>
              <div className="flex items-baseline gap-2">
                <TrendingUp className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="text-2xl font-bold tabular-nums">
                  {data.maxRatio != null ? `${data.maxRatio.toFixed(1)}×` : "—"}
                </span>
              </div>
            </StatCard>
          </div>

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
                    {data.packs.map((p) => (
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
                    {data.rows.map((r, i) => (
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

          <p className="mt-6 text-[11px] text-muted-foreground/80">
            {bg
              ? `Сравнението е по конкретна опаковка (Национален №), не по молекула — една и съща молекула се предлага в опаковки с различен размер, чиито единични цени не са съпоставими. Ценовата разлика НЕ е нередност — може да отразява обем, срок на доставка или условия по договора. Отворете отделна опаковка, за да видите движението на цената по месеци. Източник: НЗОК „Справка 5" (Наредба 10/2009), ${data.year} г.`
              : `Compared at pack identity (Национален №), not molecule — the same molecule ships in packs whose unit prices are not comparable. A price gap is NOT an irregularity — it can reflect volume, delivery period or contract terms. Open a pack for its month-by-month price trend. Source: NHIF "Справка 5" (Наредба 10/2009), ${data.year}.`}
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
