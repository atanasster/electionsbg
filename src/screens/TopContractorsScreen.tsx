// /procurement/contractors — "Топ изпълнители". Server-side leaderboard over the
// whole contractor set (~29.5k), scoped by ?pscope and filterable by CPV division +
// MP-tie, replacing the old top-1,000 client-side blob. Mirrors the /procurement/
// contracts browser: ProcurementSectionHeader (breadcrumb + scope) → 3-KPI strip →
// DbDataTable (resource "contractor_rankings", 122). The division filter is ALWAYS
// sent ('ALL' by default) — the rollup matview would double-count without it.

import { FC, useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Receipt } from "lucide-react";
import { DbDataTable, type DbTableResponse } from "@/ux/data_table/DbDataTable";
import type { DataTableColumnDef } from "@/ux/data_table/utils";
import { Title } from "@/ux/Title";
import { ProcurementSectionHeader } from "@/screens/components/procurement/ProcurementSectionHeader";
import { FollowStar } from "@/screens/components/procurement/FollowStar";
import { CpvFilterCombobox } from "@/screens/components/procurement/CpvFilterCombobox";
import { MpTiedToggle } from "@/screens/components/procurement/MpTiedToggle";
import { ContractorsKpiStrip } from "@/screens/components/procurement/ContractorsKpiStrip";
import { useScopeWindow } from "@/data/scope/useScopeWindow";
import { useUrlContractorFilters } from "@/data/procurement/useUrlContractorFilters";
import { useContractorScopeKpis } from "@/data/procurement/useContractorScopeKpis";
import { useContractorDivisions } from "@/data/procurement/useContractorDivisions";
import { formatEur, formatEurWithOther } from "@/lib/currency";
import { decodeEntities } from "@/lib/decodeEntities";
import { CompanyLink } from "@/screens/components/procurement/CompanyLink";

interface ContractorRow {
  eik: string;
  name: string;
  totalEur: number;
  contractCount: number;
  isMpTied: boolean;
  totalOther: Record<string, number>;
}

export const TopContractorsScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const { from, to, all, year, scopeKey } = useScopeWindow();
  const {
    cpvSel,
    setCpvSel,
    mpTied,
    setMpTied,
    extraFilters,
    hasActiveFilters,
    clearFilters,
  } = useUrlContractorFilters();
  const { data: kpis } = useContractorScopeKpis();
  const { data: divisions } = useContractorDivisions();

  // Memoized so its identity only changes when scopeKey does. DbDataTable's
  // pagination-reset effect keys on the scope prop by identity, so a fresh inline
  // literal each render (this screen's onData writes state on every response, forcing
  // a re-render) would snap the table back to page 0 as soon as a later page loads.
  const scope = useMemo(
    () => ({ col: "scope_key", val: scopeKey }),
    [scopeKey],
  );

  // Reactive Σ€ + contractor count from the table's own server aggregate — moves with
  // the CPV / MP-tied filters and the search box (the scope-level KPIs do not).
  const [agg, setAgg] = useState<{ sumTotalEur?: number; count?: number }>({});
  const handleData = useCallback((resp: DbTableResponse<ContractorRow>) => {
    setAgg({
      sumTotalEur: resp.aggregates?.sumTotalEur,
      count: resp.aggregates?.count ?? resp.total,
    });
  }, []);

  const columns = useMemo<DataTableColumnDef<ContractorRow, unknown>[]>(
    () => [
      {
        id: "rank",
        header: "#",
        enableSorting: false,
        meta: { exportable: false },
        cell: ({ row, table }) =>
          table.getState().pagination.pageIndex *
            table.getState().pagination.pageSize +
          row.index +
          1,
      },
      {
        id: "name",
        accessorFn: (r) => r.name,
        header: t("procurement_index_col_contractor") || "Изпълнител",
        cell: ({ row }) => {
          const e = row.original;
          return (
            <div className="flex items-center gap-2 flex-wrap">
              <FollowStar
                kind="company"
                id={e.eik}
                label={e.name}
                className="shrink-0"
              />
              <CompanyLink eik={e.eik} className="font-medium hover:underline">
                {decodeEntities(e.name)}
              </CompanyLink>
              <span className="text-xs text-muted-foreground">{e.eik}</span>
              {e.isMpTied ? (
                <span className="inline-block rounded bg-amber-200/60 dark:bg-amber-800/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                  {t("procurement_index_mp_tag") || "Депутат"}
                </span>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "total_eur",
        accessorFn: (r) => r.totalEur,
        header: t("procurement_index_col_total") || "Общо",
        meta: { align: "right" },
        cell: ({ row }) =>
          formatEurWithOther(
            row.original.totalEur,
            row.original.totalOther,
            i18n.language,
          ) || "—",
      },
      {
        id: "contract_count",
        accessorFn: (r) => r.contractCount,
        header: t("procurement_index_col_contracts") || "Договори",
        meta: { align: "right" },
        cell: ({ row }) => row.original.contractCount.toLocaleString("bg-BG"),
      },
    ],
    [t, i18n.language],
  );

  return (
    <>
      <Title description="Top procurement contractors, scoped by period and searchable across the whole corpus.">
        {t("procurement_index_top_contractors") || "Топ изпълнители"}
      </Title>
      <ProcurementSectionHeader
        current="procurement_index_top_contractors"
        scopeMode="toggle"
      />
      <section aria-label="top-contractors" className="my-4">
        <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Receipt className="h-4 w-4 shrink-0" />
          {all
            ? t("procurement_scope_all") || "Full corpus, all years."
            : year != null
              ? t("procurement_scope_year", { year }) ||
                `Showing contractors for ${year}.`
              : `${from ?? ""}${to ? ` → ${to}` : " → …"}`}
        </div>

        <ContractorsKpiStrip
          sumTotalEur={agg.sumTotalEur}
          kpis={kpis}
          filtersActive={hasActiveFilters}
        />

        <DbDataTable<ContractorRow>
          resource="contractor_rankings"
          scope={scope}
          extraFilters={extraFilters}
          columns={columns}
          onData={handleData}
          defaultSort={[{ id: "total_eur", desc: true }]}
          pageSize={25}
          initialSearch={params.get("q") ?? ""}
          searchPlaceholder={
            t("procurement_contractors_search") || "Търси изпълнител…"
          }
          toolbar={
            <>
              {divisions && divisions.length > 0 ? (
                <CpvFilterCombobox
                  value={cpvSel}
                  onChange={setCpvSel}
                  divisions={divisions}
                />
              ) : null}
              <MpTiedToggle checked={mpTied} onChange={setMpTied} />
              {hasActiveFilters ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-xs text-primary underline underline-offset-2 hover:no-underline"
                >
                  {t("contracts_clear_filters") || "Изчисти филтрите"}
                </button>
              ) : null}
            </>
          }
          renderAggregates={(footerAgg, total, exact) => (
            <span className="text-sm text-muted-foreground">
              <span className="font-semibold tabular-nums text-foreground">
                {formatEur(footerAgg.sumTotalEur ?? 0)}
              </span>{" "}
              {t("company_contracts_total_over") || "по"}{" "}
              <span className="tabular-nums">
                {exact ? "" : "≈"}
                {(footerAgg.count ?? total).toLocaleString("bg-BG")}
              </span>{" "}
              {t("contractors_word") || "изпълнителя"}
            </span>
          )}
        />
      </section>
    </>
  );
};
