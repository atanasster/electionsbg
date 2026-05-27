// /procurement/by-settlement — landing page that lists every settlement
// with at least one local-tier contract on file, plus a "national
// procurement" card for the central tier (ministries, state agencies,
// national state companies) whose Sofia HQ is *not* a meaningful proxy
// for where the contract was spent.
//
// Methodology mirrors what's in scripts/procurement/by_settlement.ts and
// what the About page describes — see also [[project_procurement_geo]].

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Building2, MapPin, Banknote, ArrowRight } from "lucide-react";
import { Title } from "@/ux/Title";
import { Card, CardContent } from "@/ux/Card";
import { useProcurementBySettlementIndex } from "@/data/procurement/useSettlementProcurement";

const eurFmt = new Intl.NumberFormat("bg-BG", { maximumFractionDigits: 0 });
const countFmt = new Intl.NumberFormat("bg-BG");

type SortKey = "totalEur" | "contractCount" | "awarderCount" | "name";

export const ProcurementBySettlementScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const q = useProcurementBySettlementIndex();
  const data = q.data;
  const [sortKey, setSortKey] = useState<SortKey>("totalEur");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!data) return [];
    const qLower = query.trim().toLowerCase();
    let rows = data.settlements;
    if (qLower) {
      rows = rows.filter(
        (s) =>
          s.name.toLowerCase().includes(qLower) ||
          s.province.toLowerCase().includes(qLower) ||
          s.obshtina.toLowerCase().includes(qLower) ||
          s.ekatte.includes(qLower),
      );
    }
    const sorted = [...rows].sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name, "bg");
      return (b[sortKey] as number) - (a[sortKey] as number);
    });
    return sorted;
  }, [data, query, sortKey]);

  if (q.isLoading || !data) {
    return (
      <div>
        <Title>
          {t("procurement_settlement_title") || "Procurement by settlement"}
        </Title>
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  const localShareOfMoney =
    data.totalEur / (data.totalEur + data.national.totalEur);

  return (
    <div>
      <Title>
        {t("procurement_settlement_title") || "Procurement by settlement"}
      </Title>

      <p className="mb-6 text-sm text-muted-foreground leading-relaxed">
        {t("procurement_settlement_intro_p1") ||
          'Every signed contract published on the central procurement register (АОП) is pinned to the buyer\'s headquarters. We exclude central ministries, state agencies and nationally-operating state companies — their Sofia HQ tells you nothing about where the contract was spent — and aggregate them separately under "National procurement".'}
      </p>

      {/* KPI strip */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              {t("procurement_settlement_kpi_settlements") || "Settlements"}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {countFmt.format(data.settlementCount)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" />
              {t("procurement_settlement_kpi_contracts") || "Local contracts"}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {countFmt.format(data.totalContracts)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <Banknote className="h-3.5 w-3.5" />
              {t("procurement_settlement_kpi_local_eur") || "Local total"}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              €{eurFmt.format(Math.round(data.totalEur))}
            </div>
            <div className="mt-1 text-xs text-muted-foreground tabular-nums">
              {(localShareOfMoney * 100).toFixed(1)}%{" "}
              {t("procurement_settlement_of_total") || "of total spending"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" />
              {t("procurement_settlement_kpi_national_eur") || "National total"}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              €{eurFmt.format(Math.round(data.national.totalEur))}
            </div>
            <div className="mt-1 text-xs text-muted-foreground tabular-nums">
              {countFmt.format(data.national.contractCount)}{" "}
              {t("procurement_settlement_contracts") || "contracts"}
              {" · "}
              {countFmt.format(data.national.awarderCount)}{" "}
              {t("procurement_settlement_buyers") || "buyers"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search + sort controls */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            t("procurement_settlement_search") ||
            "Search settlement, municipality, province…"
          }
          className="min-w-[220px] flex-1 rounded-md border bg-background px-3 py-1.5 text-sm shadow-sm"
        />
        <label className="text-xs text-muted-foreground">
          {t("procurement_settlement_sort") || "Sort by"}:{" "}
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="rounded-md border bg-background px-2 py-1 text-xs"
          >
            <option value="totalEur">
              {t("procurement_settlement_sort_eur") || "Total EUR"}
            </option>
            <option value="contractCount">
              {t("procurement_settlement_sort_contracts") || "Contracts"}
            </option>
            <option value="awarderCount">
              {t("procurement_settlement_sort_buyers") || "Buyers"}
            </option>
            <option value="name">
              {t("procurement_settlement_sort_name") || "Name (A→Z)"}
            </option>
          </select>
        </label>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {countFmt.format(filtered.length)}{" "}
          {t("procurement_settlement_results") || "results"}
        </span>
      </div>

      {/* Sortable settlements table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 w-10">#</th>
                  <th className="text-left px-3 py-2">
                    {t("procurement_settlement_col_name") || "Settlement"}
                  </th>
                  <th className="text-left px-3 py-2 hidden md:table-cell">
                    {t("procurement_settlement_col_province") || "Province"}
                  </th>
                  <th className="text-right px-3 py-2 tabular-nums">
                    {t("procurement_settlement_col_eur") || "Total EUR"}
                  </th>
                  <th className="text-right px-3 py-2 tabular-nums hidden sm:table-cell">
                    {t("procurement_settlement_col_contracts") || "Contracts"}
                  </th>
                  <th className="text-right px-3 py-2 tabular-nums hidden md:table-cell">
                    {t("procurement_settlement_col_buyers") || "Buyers"}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.slice(0, 500).map((s, idx) => (
                  <tr key={s.ekatte} className="hover:bg-muted/30">
                    <td className="px-3 py-2 text-muted-foreground tabular-nums">
                      {idx + 1}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        to={`/procurement/settlement/${s.ekatte}`}
                        className="font-medium hover:underline"
                      >
                        {s.name}
                      </Link>
                      <div className="text-xs text-muted-foreground md:hidden">
                        {s.province}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground hidden md:table-cell">
                      {s.province}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      €{eurFmt.format(Math.round(s.totalEur))}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums hidden sm:table-cell">
                      {countFmt.format(s.contractCount)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums hidden md:table-cell">
                      {countFmt.format(s.awarderCount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length > 500 && (
            <div className="border-t px-3 py-2 text-center text-xs text-muted-foreground">
              {t("procurement_settlement_truncated_msg") ||
                "Showing the first 500 settlements — refine the search to narrow."}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="mt-6 text-xs text-muted-foreground">
        {t("procurement_settlement_footnote") ||
          "Buyer HQ is the location proxy. Schools, hospitals, municipalities, universities, regional government offices, forestry districts and local utilities are pinned to their HQ. National procurement (ministries, central agencies, national state companies) is rolled up separately."}{" "}
        <Link to="/about" className="underline hover:no-underline">
          {t("procurement_settlement_methodology_link") ||
            "Read the methodology"}
        </Link>
        .
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {i18n.language === "bg" ? "Източник: " : "Source: "}
        <a
          href="https://data.egov.bg/data/resourceView/3ec550fc-4058-445c-b938-cb21b6d1b0f3"
          target="_blank"
          rel="noopener noreferrer"
          className="underline inline-flex items-center gap-0.5 hover:no-underline"
        >
          data.egov.bg АОП OCDS
          <ArrowRight className="inline h-3 w-3 -rotate-45" />
        </a>
      </p>
    </div>
  );
};
