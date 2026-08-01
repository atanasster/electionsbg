// The shared contracts-browser body — one server-side DbDataTable over the `contracts`
// resource with the KPI strip, the procedure-mix bar, the CPV / procedure / risk-grade /
// single-bidder toolbar, and the aggregates footer. Extracted from
// ProcurementSettlementContractsSection so the settlement page, the person contracts browser
// (docs/plans/person-procurement-browser-v1.md) and any future per-entity browser render the
// SAME filters, KPIs and columns instead of three near-identical copies.
//
// What each caller supplies is only what actually differs:
//   • `scope`   — the IDENTITY filter(s): a semi-join (awarder_ekatte / contractor_of_person_*)
//                 plus any always-on predicate the page IS (e.g. not_consortium_member for a
//                 person, so the count basis matches person_procurement). These ride BOTH the
//                 table's fixedFilters and every facet, so the strip describes the rows below it.
//   • `window`  — the INCLUSIVE [from,to] pair (scopeRange), turned into a `date` range filter.
//                 INCLUSIVE on purpose: the KPI functions these pages pair with read `date <= to`,
//                 so the browser must too (see procurement_settlement_scope.data.test.ts).
//   • `resetKey`— the page identity (ekatte / person key); the aggregate strip resets on it so a
//                 stale Σ€/count never lingers when React Router reuses this component.
//   • columns / filter options / labels — cosmetic passthrough.
//
// A `required` semi-join 400s on an empty value, so the CALLER must guard (return null) before
// mounting this — every hook here fires on mount, including the facet queries.

import { FC, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DbDataTable,
  type DbColumnFilter,
  type DbTableResponse,
} from "@/ux/data_table/DbDataTable";
import { ContractsAnalysisStrip } from "@/screens/components/procurement/ContractsAnalysisStrip";
import { ContractsAggregatesFooter } from "@/screens/components/procurement/ContractsAggregatesFooter";
import { ProcedureBucketSelect } from "@/screens/components/procurement/ProcedureBucketSelect";
import { RiskGradeFilter } from "@/screens/components/procurement/RiskGradeFilter";
import { SingleBidderToggle } from "@/screens/components/procurement/SingleBidderToggle";
import {
  CpvFilterCombobox,
  CPV_ALL,
} from "@/screens/components/procurement/CpvFilterCombobox";
import {
  useContractColumns,
  type ContractColumnId,
} from "@/screens/components/procurement/contractColumns";
import { useContractsAnalytics } from "@/data/procurement/useContractsAnalytics";
import {
  useUrlProcurementFilters,
  type UseUrlProcurementFiltersOptions,
} from "@/data/procurement/useUrlProcurementFilters";
import { useNgoForeignFundedByEik } from "@/data/procurement/usePepConnectedByEik";
import type { ProcurementContract } from "@/data/dataTypes";

export type ContractsBrowserSectionProps = {
  /** IDENTITY scope: semi-join / place filter(s) + any always-on predicate. Rides
   *  fixedFilters AND every facet. */
  scope: DbColumnFilter[];
  /** INCLUSIVE [from,to] (scopeRange). `null` from → no date filter (full corpus). Named
   *  `dateWindow`, not `window`, so it never shadows the global `window` inside this
   *  deliberately-reusable component. */
  dateWindow: [string | null, string | null];
  /** Aggregate-reset identity — the page changes when this does. */
  resetKey: string;
  columns: ContractColumnId[];
  dateMode?: "signed" | "published";
  titleClamp?: "sm" | "md";
  sortableNames?: boolean;
  showAppealChip?: boolean;
  /** A narrow (per-entity / per-settlement) CPV spread reads better as a shifting list. */
  reactiveCpv?: boolean;
  /** useUrlProcurementFilters options — defaults to the single-bidder + risk-grade set. */
  filterOpts?: UseUrlProcurementFiltersOptions;
  countLabel?: string;
  initialSearch?: string;
  searchPlaceholder?: string;
  defaultSort?: { id: string; desc: boolean }[];
  ariaLabel?: string;
};

const DEFAULT_FILTER_OPTS: UseUrlProcurementFiltersOptions = {
  toggleParam: "single",
  withRisk: true,
};

export const ContractsBrowserSection: FC<ContractsBrowserSectionProps> = ({
  scope,
  dateWindow,
  resetKey,
  columns: columnIds,
  dateMode = "signed",
  titleClamp = "sm",
  sortableNames = true,
  showAppealChip = true,
  reactiveCpv = true,
  filterOpts = DEFAULT_FILTER_OPTS,
  countLabel,
  initialSearch = "",
  searchPlaceholder,
  defaultSort = [{ id: "date", desc: true }],
  ariaLabel = "contracts",
}) => {
  const { t } = useTranslation();
  const [from, to] = dateWindow;
  // Guard-before-mount contract (see header): a `required` semi-join 400s on an empty scope.
  // The wrappers (settlement, person) return null before mount; warn in dev if one forgets,
  // rather than firing a rejected request under a page heading.
  useEffect(() => {
    if (import.meta.env.DEV && scope.length === 0)
      console.warn(
        "ContractsBrowserSection mounted with an empty scope — the caller must guard before mounting (a required semi-join will 400).",
      );
  }, [scope.length]);

  const {
    procBucket,
    cpvSel: cpvDiv,
    toggle: singleBidder,
    setProcBucket,
    setCpvSel: setCpvDiv,
    setToggle: setSingleBidder,
    grades,
    setGrades,
    hasActiveFilters,
    clearFilters,
  } = useUrlProcurementFilters(filterOpts);

  const { byEik: ngoByEik } = useNgoForeignFundedByEik();

  // The identity scope + the window: applied to the table AND every facet, so the KPI strip
  // describes exactly the rows below it.
  const scopeAndWindow = useMemo<DbColumnFilter[]>(
    () => [
      ...scope,
      ...(from ? [{ id: "date", min: from, max: to ?? undefined }] : []),
    ],
    [scope, from, to],
  );

  const cpvF = useMemo<DbColumnFilter[]>(
    () =>
      cpvDiv !== CPV_ALL
        ? [
            {
              id: "cpv",
              value: cpvDiv.includes(",") ? cpvDiv.split(",") : cpvDiv,
            },
          ]
        : [],
    [cpvDiv],
  );
  const singleF = useMemo<DbColumnFilter[]>(
    () => (singleBidder ? [{ id: "number_of_tenderers", min: 1, max: 1 }] : []),
    [singleBidder],
  );
  // Server-side over this page's whole contract set (migration 112), not the loaded page.
  const gradeF = useMemo<DbColumnFilter[]>(
    () => (grades.length ? [{ id: "risk_grade", value: grades }] : []),
    [grades],
  );

  // Identity + window ride fixedFilters — they are what the page IS, not something the reader
  // chose — and the user-editable dimensions ride extraFilters. DbDataTable resets pagination
  // when `extraFilters` changes identity, so keeping the scope out of it also stops a scope
  // change from being conflated with a filter change.
  const fixedFilters = useMemo<DbColumnFilter[]>(
    () => [{ id: "tag", value: ["contract"] }, ...scopeAndWindow],
    [scopeAndWindow],
  );

  const { groupedMethods, cpvOptions, singleBidPct, directPct, methodF } =
    useContractsAnalytics({
      resource: "contracts",
      // gradeF rides fixedFilters so the integrity KPIs describe the same set the count and
      // Σ€ above them do — otherwise a grade-filtered total sits beside percentages computed
      // over everything.
      fixedFilters: [...fixedFilters, ...gradeF],
      singleFilter: singleF,
      cpvFilter: cpvF,
      procBucket,
      reactiveCpv,
      onBucketInvalid: () => setProcBucket(null),
    });

  const extraFilters = useMemo<DbColumnFilter[]>(
    () => [...singleF, ...methodF, ...cpvF, ...gradeF],
    [singleF, methodF, cpvF, gradeF],
  );

  const [agg, setAgg] = useState<{ sumAmountEur?: number; count?: number }>({});
  // Reset when the page's identity or window changes: React Router reuses this component and
  // DbDataTable keeps the previous page's data while refetching, so without this the last
  // page's Σ€ and count linger in the strip until the new query resolves.
  useEffect(() => setAgg({}), [resetKey, from, to]);
  const handleData = (resp: DbTableResponse<ProcurementContract>) => {
    setAgg({
      sumAmountEur: resp.aggregates?.sumAmountEur,
      count: resp.aggregates?.count ?? resp.total,
    });
  };

  const columns = useContractColumns({
    show: columnIds,
    dateMode,
    ngoByEik,
    showAppealChip,
    sortableNames,
    titleClamp,
  });

  return (
    <section aria-label={ariaLabel} className="my-4">
      <ContractsAnalysisStrip
        sumAmountEur={agg.sumAmountEur}
        count={agg.count}
        singleBidPct={singleBidPct}
        directPct={directPct}
        groupedMethods={groupedMethods}
        procBucket={procBucket}
        onSelectBucket={setProcBucket}
        countLabel={countLabel ?? (t("company_contracts") || "Договори")}
      />

      <DbDataTable<ProcurementContract>
        resource="contracts"
        fixedFilters={fixedFilters}
        extraFilters={extraFilters}
        columns={columns}
        onData={handleData}
        defaultSort={defaultSort}
        pageSize={25}
        initialSearch={initialSearch}
        searchPlaceholder={
          searchPlaceholder ??
          (t("procurement_contracts_search") ||
            "Търси възложител / изпълнител / предмет…")
        }
        toolbar={
          <>
            {cpvOptions.length > 0 ? (
              <CpvFilterCombobox
                value={cpvDiv}
                onChange={setCpvDiv}
                divisions={cpvOptions}
              />
            ) : null}
            <ProcedureBucketSelect
              groupedMethods={groupedMethods}
              value={procBucket}
              onChange={setProcBucket}
            />
            <RiskGradeFilter value={grades} onChange={setGrades} />
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
            word={t("procurement_contracts_word") || "договора"}
          />
        )}
      />
    </section>
  );
};
