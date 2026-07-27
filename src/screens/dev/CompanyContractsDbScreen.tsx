// DB-driven contracts / annexes drill-down for both entity sides:
// /company/:eik/contracts|annexes (scoped to contractor_eik) and
// /awarder/:eik/contracts (scoped to awarder_eik via side="awarder").
// Server-side paginated/sorted/filtered/aggregated via DbDataTable →
// /api/db/table (the `contracts` resource, tag fixed per route). Works for ANY
// company. Risk chips are scored client-side per page row (from the shared
// risk-indexes payload) — display only, since risk isn't a Postgres column.
// See docs/plans/pg-query-performance.md.

import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  cpvDivisionName,
  procedureBucket,
  procedureLabel,
} from "@/lib/cpvSectors";
import {
  FILTER_ALL,
  useUrlProcurementFilters,
} from "@/data/procurement/useUrlProcurementFilters";
import { SEO } from "@/ux/SEO";
import { DbDataTable, type DbColumnFilter } from "@/ux/data_table/DbDataTable";
import type { DataTableColumnDef } from "@/ux/data_table/utils";
import { ContractAmount } from "@/screens/components/procurement/ContractAmount";
import { RiskBadges } from "@/screens/components/procurement/RiskBadges";
import { useContractRiskScorer } from "@/data/procurement/useContractRiskFlags";
import { ContractsAnalysisStrip } from "@/screens/components/procurement/ContractsAnalysisStrip";
import { ProcedureBucketSelect } from "@/screens/components/procurement/ProcedureBucketSelect";
import { SingleBidderToggle } from "@/screens/components/procurement/SingleBidderToggle";
import { ContractsAggregatesFooter } from "@/screens/components/procurement/ContractsAggregatesFooter";
import { useContractsAnalytics } from "@/data/procurement/useContractsAnalytics";
import type { ProcurementContract } from "@/data/dataTypes";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const YEARS: string[] = Array.from({ length: 2026 - 2007 + 1 }, (_, i) =>
  String(2026 - i),
);

export const CompanyContractsDbScreen: FC<{
  tag: "contract" | "contractAmendment";
  /** Which side of the contract the :eik entity is on. "contractor" (default)
   *  lists what the company won; "awarder" lists what the state buyer paid. */
  side?: "contractor" | "awarder";
}> = ({ tag, side = "contractor" }) => {
  const { eik = "" } = useParams();
  const { t, i18n } = useTranslation();
  const { scoreRow } = useContractRiskScorer();

  // Filters are URL-backed (?year / ?proc / ?cpv / ?single) so a filtered view is
  // shareable — the app's URL-contract convention. This page adds the ?year
  // dimension the global browsers lack. The free-text search is seeded once from
  // ?q (DbDataTable owns its box thereafter).
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get("q") ?? undefined;
  const {
    year,
    procBucket,
    cpvSel: cpvDiv,
    toggle: singleBidder,
    setYear,
    setProcBucket,
    setCpvSel: setCpvDiv,
    setToggle: setSingleBidder,
    hasActiveFilters,
    clearFilters,
  } = useUrlProcurementFilters({ toggleParam: "single", withYear: true });

  const [companyName, setCompanyName] = useState("");
  // Reactive headline aggregates (Σ €, count) for the whole FILTERED set —
  // DbDataTable computes them server-side and hands them back via onData.
  const [agg, setAgg] = useState<{ sumAmountEur?: number; count?: number }>({});
  // React Router reuses this component instance when only :eik changes, so clear
  // the entity-derived state on switch — otherwise the previous company's name +
  // KPI figures linger until the new query's first page resolves.
  useEffect(() => {
    setCompanyName("");
    setAgg({});
  }, [eik, tag, side]);

  const isAwarder = side === "awarder";
  const scopeCol = isAwarder ? "awarder_eik" : "contractor_eik";
  const entityHref = isAwarder ? `/awarder/${eik}` : `/company/${eik}`;
  const isAnnex = tag === "contractAmendment";
  const heading = isAnnex ? "Анекси" : "Договори";

  // Entity name + reactive aggregates come free on every loaded page — no extra
  // request.
  const handleData = useCallback(
    (resp: {
      rows: ProcurementContract[];
      aggregates?: Record<string, number>;
      total?: number;
    }) => {
      const first = resp.rows[0];
      const name = isAwarder ? first?.awarderName : first?.contractorName;
      if (name) setCompanyName(name);
      setAgg({
        sumAmountEur: resp.aggregates?.sumAmountEur,
        count: resp.aggregates?.count ?? resp.total,
      });
    },
    [isAwarder],
  );

  // Individual active-filter fragments, so each facet can apply every filter
  // EXCEPT its own dimension (a filter-scoped facet that still shows all its own
  // options — see /api/db/facets `filters` and ProcedureMixBar).
  const yearF = useMemo<DbColumnFilter[]>(
    () =>
      year !== FILTER_ALL
        ? [{ id: "date", min: `${year}-01-01`, max: `${year}-12-31` }]
        : [],
    [year],
  );
  const singleF = useMemo<DbColumnFilter[]>(
    () => (singleBidder ? [{ id: "number_of_tenderers", min: 1, max: 1 }] : []),
    [singleBidder],
  );
  const cpvF = useMemo<DbColumnFilter[]>(
    () => (cpvDiv !== FILTER_ALL ? [{ id: "cpv", value: cpvDiv }] : []),
    [cpvDiv],
  );

  // Facet-driven analysis (procedure mix, integrity KPIs, CPV options), shared
  // with the global /procurement/contracts browser. Entity-scoped; the year
  // filter is a common filter applied to every facet; the CPV facet is reactive
  // (its counts reflect the active method/single filters). The bid facet's
  // limit bounds distinct bidder-counts, not rows — real counts are tiny (~1–30)
  // and value === 1 is always present, so the single-bid denominator is safe.
  const { groupedMethods, cpvOptions, singleBidPct, directPct, methodF } =
    useContractsAnalytics({
      resource: "contracts",
      scope: { col: scopeCol, val: eik },
      fixedFilters: [{ id: "tag", value: [tag] }],
      commonFilters: yearF,
      singleFilter: singleF,
      cpvFilter: cpvF,
      procBucket,
      reactiveCpv: true,
      onBucketInvalid: () => setProcBucket(null),
    });

  const extraFilters = useMemo<DbColumnFilter[]>(
    () => [...yearF, ...singleF, ...methodF, ...cpvF],
    [yearF, singleF, methodF, cpvF],
  );

  const columns = useMemo<DataTableColumnDef<ProcurementContract, unknown>[]>(
    () => [
      {
        // One canonical date = the signing date (always populated; falls back to
        // `date` at load). Sorting stays on the indexed `date` column via
        // defaultSort — date_signed is unindexed — so the header isn't resortable.
        id: "date",
        accessorFn: (r) => r.dateSigned ?? r.date,
        header: t("company_contract_signed") || "Signed",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="tabular-nums whitespace-nowrap">
            {row.original.dateSigned ?? row.original.date}
          </div>
        ),
      },
      isAwarder
        ? {
            id: "contractor_name",
            accessorFn: (r: ProcurementContract) => r.contractorName,
            header: t("procurement_col_contractor") || "Contractor",
            cell: ({ row }) => (
              <Link
                to={`/company/${row.original.contractorEik}`}
                className="text-sm hover:underline"
              >
                {row.original.contractorName}
              </Link>
            ),
          }
        : {
            id: "awarder_name",
            accessorFn: (r: ProcurementContract) => r.awarderName,
            header: t("company_contract_awarder") || "Awarder",
            cell: ({ row }) => (
              <Link
                to={`/awarder/${row.original.awarderEik}`}
                className="text-sm hover:underline"
              >
                {row.original.awarderName}
              </Link>
            ),
          },
      {
        id: "title",
        accessorFn: (r) => r.title,
        header: t("company_contract_subject") || "Subject",
        enableSorting: false,
        cell: ({ row }) => (
          <Link
            to={`/procurement/contract/${row.original.key}`}
            className="text-sm line-clamp-2 max-w-md inline-block hover:text-primary hover:underline"
            title={row.original.title || undefined}
          >
            {row.original.title || "—"}
          </Link>
        ),
      },
      {
        id: "amount_eur",
        accessorFn: (r) => r.amountEur,
        header: t("company_contract_amount") || "Amount",
        meta: { align: "right" },
        cell: ({ row }) => (
          <ContractAmount
            amountEur={row.original.amountEur}
            amount={row.original.amount}
            currency={row.original.currency}
          />
        ),
      },
      {
        // Procedure type, bucketed + translated (same vocabulary as the mix bar +
        // filter). Not sortable — the bucket order ≠ the raw-string order the DB
        // would sort by; discovery is via the chart/filter instead.
        id: "procedure",
        header: t("company_contract_procedure") || "Procedure",
        enableSorting: false,
        className: "hidden md:table-cell",
        cell: ({ row }) => (
          <span className="inline-block whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {procedureLabel(
              procedureBucket(row.original.procurementMethod),
              i18n.language,
            )}
          </span>
        ),
      },
      {
        // Bid count — sortable competition signal. Coloured rose when the shared
        // scorer flags weak competition (single bidder / materially fewer than the
        // sector norm), the same signal the СИГНАЛИ pill used to carry (now hidden
        // there via hideWeakCompetition, so it isn't shown twice).
        id: "number_of_tenderers",
        accessorFn: (r) => r.numberOfTenderers ?? null,
        header: t("company_contracts_bids") || "Bids",
        className: "hidden sm:table-cell",
        cell: ({ row }) => {
          const n = row.original.numberOfTenderers;
          if (n == null)
            return <span className="text-xs text-muted-foreground">—</span>;
          const weak = scoreRow(row.original).flags.weakCompetition;
          return (
            <span
              className={`block text-right text-sm tabular-nums ${
                weak ? "font-medium text-rose-600 dark:text-rose-400" : ""
              }`}
            >
              {n}
            </span>
          );
        },
      },
      {
        // Reference-only column (migration 087): for a consortium MEMBER row the
        // amount is €0 (its real share isn't public), so the full joint-contract
        // value is shown HERE, in its own column, to avoid distorting a sort on the
        // real amount. Empty for ordinary rows.
        id: "consortium_full_eur",
        accessorFn: (r) => r.consortiumFullEur ?? null,
        header: t("company_contract_consortium_full", {
          defaultValue: "Обединение",
        }),
        meta: { align: "right" },
        className: "hidden lg:table-cell",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.consortiumRole === "member" ? (
            <span
              className="whitespace-nowrap text-xs text-muted-foreground"
              title={t("company_contract_consortium_full_tip", {
                defaultValue:
                  "Пълна стойност на договора на обединението — тази фирма е участник; реалният ѝ дял не е публичен.",
              })}
            >
              {row.original.consortiumEik ? (
                <Link
                  to={`/company/${row.original.consortiumEik}`}
                  className="text-primary hover:underline"
                >
                  <ContractAmount amountEur={row.original.consortiumFullEur} />
                </Link>
              ) : (
                <ContractAmount amountEur={row.original.consortiumFullEur} />
              )}
            </span>
          ) : null,
      },
      {
        id: "risk",
        header: t("company_contract_risk") || "Flags",
        enableSorting: false,
        // Bid count moved to its own column, so drop the weak-competition chip
        // here to avoid showing the same signal twice.
        cell: ({ row }) => (
          <RiskBadges result={scoreRow(row.original)} hideWeakCompetition />
        ),
      },
      // The source column was removed: "Детайли" duplicated the subject link
      // (both → /procurement/contract/:key) and the external ЕОП/egov link lives
      // on that detail screen (ContractDetailScreen).
    ],
    [t, i18n.language, scoreRow, isAwarder],
  );

  return (
    <>
      <SEO
        title={`${heading} — ${companyName || `ЕИК ${eik}`}`}
        description={`${heading} — ${companyName || `ЕИК ${eik}`}`}
      />
      <section aria-label={heading} className="w-full px-4 py-6 md:px-6">
        {/* Entity-first header: the company is the H1, "Договори/Анекси" a kicker. */}
        <div className="mb-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {heading}
          </div>
          <h1 className="text-2xl font-bold">
            <Link to={entityHref} className="hover:underline">
              {companyName || `ЕИК ${eik}`}
            </Link>
          </h1>
          <div className="mt-1 text-sm text-muted-foreground">ЕИК {eik}</div>
        </div>

        {/* Reactive headline KPIs (react to the active filters) + integrity KPIs
            (single-bidder / direct-award share) + the filter-scoped, clickable
            procedure-mix bar. */}
        <ContractsAnalysisStrip
          sumAmountEur={agg.sumAmountEur}
          count={agg.count}
          singleBidPct={singleBidPct}
          directPct={directPct}
          groupedMethods={groupedMethods}
          procBucket={procBucket}
          onSelectBucket={setProcBucket}
          countLabel={
            isAnnex
              ? t("procurement_index_amendments") || "Анекси"
              : t("company_contracts") || "Договори"
          }
        />

        <DbDataTable<ProcurementContract>
          resource="contracts"
          scope={{ col: scopeCol, val: eik }}
          fixedFilters={[{ id: "tag", value: [tag] }]}
          extraFilters={extraFilters}
          columns={columns}
          onData={handleData}
          defaultSort={[{ id: "date", desc: true }]}
          pageSize={25}
          initialSearch={initialSearch}
          searchPlaceholder={
            isAwarder
              ? t("awarder_contracts_search") || "Търси изпълнител / предмет…"
              : t("company_contracts_search") || "Търси възложител / предмет…"
          }
          toolbar={
            <>
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger className="w-auto h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FILTER_ALL}>
                    {t("company_contracts_all_years") || "Всички години"}
                  </SelectItem>
                  {YEARS.map((y) => (
                    <SelectItem key={y} value={y}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {cpvOptions.length > 0 ? (
                <Select value={cpvDiv} onValueChange={setCpvDiv}>
                  <SelectTrigger className="w-auto h-9 max-w-[220px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={FILTER_ALL}>
                      {t("company_contracts_all_cpv") ||
                        "Всички категории (CPV)"}
                    </SelectItem>
                    {cpvOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {cpvDivisionName(o.value, i18n.language)} ({o.count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              <ProcedureBucketSelect
                groupedMethods={groupedMethods}
                value={procBucket}
                onChange={setProcBucket}
              />
              <SingleBidderToggle
                checked={singleBidder}
                onChange={setSingleBidder}
              />
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
            <ContractsAggregatesFooter
              agg={footerAgg}
              total={total}
              exact={exact}
              word={
                isAnnex
                  ? t("procurement_annexes_word") || "анекса"
                  : t("procurement_contracts_word") || "договора"
              }
            />
          )}
        />
      </section>
    </>
  );
};
