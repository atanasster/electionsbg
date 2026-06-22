// /procurement/settlement/:ekatte — per-settlement procurement detail.
// Shows the buyer breakdown (municipality, schools, hospitals, etc.),
// top contracts, and annual trend for one settlement.

import { FC } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Banknote, Building2, MapPin } from "lucide-react";
import { Title } from "@/ux/Title";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useSettlementProcurement } from "@/data/procurement/useSettlementProcurement";
import type { ProcurementAwarderTier } from "@/data/dataTypes";

const eurFmt = new Intl.NumberFormat("bg-BG", { maximumFractionDigits: 0 });
const countFmt = new Intl.NumberFormat("bg-BG");

const TIER_LABEL_BG: Record<ProcurementAwarderTier, string> = {
  municipal: "Община",
  school: "Училище",
  hospital: "Болница",
  university: "Университет",
  forestry: "Горско стопанство",
  regional_gov: "Регионална администрация",
  utility: "Комунално дружество",
  central_ministry: "Министерство",
  central_agency: "Държавна агенция",
  national_state_co: "Държавна компания",
  other: "Друго",
};
const TIER_LABEL_EN: Record<ProcurementAwarderTier, string> = {
  municipal: "Municipality",
  school: "School",
  hospital: "Hospital",
  university: "University",
  forestry: "Forestry",
  regional_gov: "Regional gov.",
  utility: "Utility",
  central_ministry: "Ministry",
  central_agency: "Agency",
  national_state_co: "State company",
  other: "Other",
};

export const ProcurementSettlementDetailScreen: FC = () => {
  const { ekatte } = useParams<{ ekatte: string }>();
  const { t, i18n } = useTranslation();
  const q = useSettlementProcurement(ekatte ?? null);
  const data = q.data;

  if (q.isLoading) {
    return (
      <div>
        <Title>{t("procurement_settlement_loading") || "Loading…"}</Title>
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <Title>
          {t("procurement_settlement_not_found_title") || "No procurement data"}
        </Title>
        <p className="text-muted-foreground">
          {t("procurement_settlement_not_found_body") ||
            "This settlement has no local-tier procurement on record. The dataset only covers contracts whose buyer headquarters resolve to a settlement in our catalog; small villages and inactive buyers may simply be missing."}
        </p>
        <p className="mt-4">
          <Link to="/procurement/by-settlement" className="underline">
            <ArrowLeft className="inline h-3.5 w-3.5 mr-1" />
            {t("procurement_settlement_back") || "Back to settlement list"}
          </Link>
        </p>
      </div>
    );
  }

  const tierLabel = i18n.language === "bg" ? TIER_LABEL_BG : TIER_LABEL_EN;

  // BG euphony: "в" becomes "във" before words starting with в/ф (във Варна,
  // във Видин, във Враца, във Велико Търново, във Филаретово). Everywhere
  // else "в" stays "в" (в София, в Пловдив, в Стара Загора).
  const bgPrep = /^[вфВФ]/.test(data.name) ? "във" : "в";
  const title =
    i18n.language === "bg"
      ? `Обществени поръчки ${bgPrep} ${data.name}`
      : `Public procurement in ${data.name}`;

  return (
    <div>
      <div className="mb-1 text-sm">
        <Link
          to="/procurement/by-settlement"
          className="text-muted-foreground hover:underline"
        >
          <ArrowLeft className="inline h-3.5 w-3.5 mr-1" />
          {t("procurement_settlement_back") || "Back to settlement list"}
        </Link>
      </div>
      <Title>{title}</Title>
      <p className="mb-6 text-sm text-muted-foreground">
        {data.province} · {data.obshtina} ·{" "}
        <span className="font-mono">EKATTE {data.ekatte}</span>
      </p>

      {/* KPI strip */}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <Banknote className="h-3.5 w-3.5" />
              {t("procurement_settlement_kpi_local_eur") || "Total"}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              €{eurFmt.format(Math.round(data.totalEur))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" />
              {t("procurement_settlement_kpi_contracts") || "Contracts"}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {countFmt.format(data.contractCount)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              {t("procurement_settlement_kpi_buyers") || "Buyers"}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {countFmt.format(data.awarders.length)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Buyer (awarder) breakdown */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>
            {t("procurement_settlement_buyers_header") ||
              "Buyers in this settlement"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 w-10">#</th>
                  <th className="text-left px-3 py-2">
                    {t("procurement_settlement_col_buyer") || "Buyer"}
                  </th>
                  <th className="text-left px-3 py-2 hidden sm:table-cell">
                    {t("procurement_settlement_col_tier") || "Type"}
                  </th>
                  <th className="text-right px-3 py-2 tabular-nums">
                    {t("procurement_settlement_col_eur") || "Total EUR"}
                  </th>
                  <th className="text-right px-3 py-2 tabular-nums hidden md:table-cell">
                    {t("procurement_settlement_col_contracts") || "Contracts"}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.awarders.map((a, idx) => (
                  <tr key={a.eik}>
                    <td className="px-3 py-2 text-muted-foreground tabular-nums">
                      {idx + 1}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        to={`/awarder/${a.eik}`}
                        className="font-medium hover:underline"
                      >
                        {a.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">
                      {tierLabel[a.tier]}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      €{eurFmt.format(Math.round(a.totalEur))}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums hidden md:table-cell">
                      {countFmt.format(a.contractCount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Top contracts */}
      {data.topContracts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              {t("procurement_settlement_top_contracts_header") ||
                "Biggest contracts"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2 w-24">
                      {t("procurement_settlement_col_date") || "Date"}
                    </th>
                    <th className="text-left px-3 py-2">
                      {t("procurement_settlement_col_contractor") ||
                        "Contractor"}
                    </th>
                    <th className="text-right px-3 py-2 tabular-nums">
                      {t("procurement_settlement_col_eur") || "EUR"}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.topContracts.slice(0, 25).map((c) => (
                    <tr key={c.key}>
                      <td className="px-3 py-2 text-muted-foreground tabular-nums">
                        {c.date}
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          to={`/company/${c.partyEik}`}
                          className="hover:underline"
                        >
                          {c.partyName}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        €{eurFmt.format(Math.round(c.amountEur ?? 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        {t("procurement_settlement_detail_footnote") ||
          'Buyer HQ is the location proxy. Central ministries and national state companies based in Sofia procure nationally — they are not shown on this page; see the "national procurement" rollup on the landing page.'}
      </p>
    </div>
  );
};
