// The contracts browser on /procurement/settlement/:ekatte — every contract awarded by a
// buyer SEATED in this settlement, with the same filters, KPI strip and columns as the
// global and per-entity browsers.
//
// Scoped server-side by the `awarder_ekatte` semi-join (functions/db_table.js): contracts
// carries no place column, so "procurement in Варна" is "every contract whose awarder is
// seated at this EKATTE". Nothing here resolves that buyer set client-side.
//
// ⚠ THE TWO DATE CONVENTIONS. This section and the page's KPI cards answer the same
// question through different SQL, so their windows must line up exactly:
//   • the KPI cards read procurement_settlement_detail, which is HALF-OPEN (date < to) —
//     useScopeWindow's pair, passed verbatim;
//   • this table's `date` range filter is INCLUSIVE (date <= max) — so it takes
//     scopeRange's pair, whose upper bound is already the day before.
// Both derive from the SAME scope, so they cannot drift; what would drift is handing
// useScopeWindow's exclusive `to` to the table, which admits one extra day and makes the
// row count disagree with the total above it. See procurement_settlement_scope.data.test.ts.
//
// ⚠ That reconciliation holds only once the PAGE passes the reader's scope to
// useSettlementProcurement. Until it does, this table narrows and the cards above it do
// not — so the two must be wired together, never one without the other.

import { FC, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
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
import { useContractColumns } from "@/screens/components/procurement/contractColumns";
import { useContractsAnalytics } from "@/data/procurement/useContractsAnalytics";
import { useUrlProcurementFilters } from "@/data/procurement/useUrlProcurementFilters";
import { useNgoForeignFundedByEik } from "@/data/procurement/usePepConnectedByEik";
import { useCpvCatalog } from "@/data/procurement/useCpvCatalog";
import { useScope } from "@/data/scope/useScope";
import { scopeRange } from "@/data/scope/scopeRange";
import { useElectionContext } from "@/data/ElectionContext";
import type { ProcurementContract } from "@/data/dataTypes";

export const ProcurementSettlementContractsSection: FC<{ ekatte: string }> = ({
  ekatte,
}) => {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  // Same guard as useSettlementProcurement. `awarder_ekatte` is declared `required`, so a
  // malformed value 400s the table — but the facet requests behind the KPI strip would
  // return an empty vocabulary at a 200, leaving a strip of zeros above an error. Refuse
  // both halves together instead of half-failing.
  const validEkatte = /^\d{5}$/.test(ekatte);
  const { scope } = useScope();
  const { selected } = useElectionContext();

  // INCLUSIVE bounds — see the header note. `scopeRange` is the shared helper the
  // awarder/company dashboards already use for the `date <= to` endpoints.
  const [from, to] = scopeRange(scope, selected);

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
  } = useUrlProcurementFilters({ toggleParam: "single", withRisk: true });

  const { byEik: ngoByEik } = useNgoForeignFundedByEik();
  const { data: cpvCatalog, isError: cpvCatalogError } = useCpvCatalog();

  // The place + the window: applied to the table AND to every facet, so the KPI strip
  // describes exactly the rows below it.
  const placeAndWindow = useMemo<DbColumnFilter[]>(
    () => [
      { id: "awarder_ekatte", value: ekatte },
      ...(from ? [{ id: "date", min: from, max: to ?? undefined }] : []),
    ],
    [ekatte, from, to],
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
  // Server-side over this settlement's whole contract set (migration 112), not the page.
  const gradeF = useMemo<DbColumnFilter[]>(
    () => (grades.length ? [{ id: "risk_grade", value: grades }] : []),
    [grades],
  );

  // The place + window ride fixedFilters — they are what the page IS, not something the
  // reader chose — and the user-editable dimensions ride extraFilters. DbDataTable resets
  // pagination when `extraFilters` changes identity, so keeping the identity scope out of
  // it also stops a scope change from being conflated with a filter change.
  const fixedFilters = useMemo<DbColumnFilter[]>(
    () => [{ id: "tag", value: ["contract"] }, ...placeAndWindow],
    [placeAndWindow],
  );

  const { groupedMethods, cpvOptions, singleBidPct, directPct, methodF } =
    useContractsAnalytics({
      resource: "contracts",
      // gradeF rides fixedFilters so the integrity KPIs describe the same set the
      // count and Σ€ above them do — otherwise a grade-filtered total sits beside
      // percentages computed over everything.
      fixedFilters: [...fixedFilters, ...gradeF],
      singleFilter: singleF,
      cpvFilter: cpvF,
      procBucket,
      // A settlement's CPV spread is narrow enough that a shifting list is more
      // helpful than confusing — the same call the per-entity screens make.
      reactiveCpv: true,
      onBucketInvalid: () => setProcBucket(null),
    });

  const extraFilters = useMemo<DbColumnFilter[]>(
    () => [...singleF, ...methodF, ...cpvF, ...gradeF],
    [singleF, methodF, cpvF, gradeF],
  );

  const [agg, setAgg] = useState<{ sumAmountEur?: number; count?: number }>({});
  // Reset when the page's identity changes: React Router reuses this component when only
  // :ekatte changes, and DbDataTable keeps the previous page's data while refetching, so
  // without this the last settlement's (or the last window's) Σ€ and count linger in the
  // strip — and leak upward through onAggregates — until the new query resolves.
  useEffect(() => setAgg({}), [ekatte, from, to]);
  // Not memoized: DbDataTable invokes onData through a ref, so an inline arrow is fine
  // and a useCallback here would imply a constraint that does not exist.
  const handleData = (resp: DbTableResponse<ProcurementContract>) => {
    setAgg({
      sumAmountEur: resp.aggregates?.sumAmountEur,
      count: resp.aggregates?.count ?? resp.total,
    });
  };

  // Both parties: a settlement spans many buyers, so neither side is implied by the
  // page the way it is on /company/:eik or /awarder/:eik. No `source` column — the
  // subject already links to the contract page, where the external link lives.
  const columns = useContractColumns({
    show: [
      "date",
      "awarder_name",
      "contractor_name",
      "title",
      "amount_eur",
      "procedure",
      "number_of_tenderers",
      "consortium_full_eur",
      "risk_cri",
    ],
    // The signing date, like the per-entity browsers: it is the date this settlement's
    // money was actually committed. Sorting stays on the indexed `date` via defaultSort.
    dateMode: "signed",
    ngoByEik,
    showAppealChip: true,
    // One settlement is a small enough row set for a name sort (MEASURED 254 ms on
    // София, the densest); the global browser leaves it off because the corpus is not.
    sortableNames: true,
    // Nine columns, one fewer than the global browser — the same squeeze, so the same
    // narrower subject clamp rather than the wider per-entity one.
    titleClamp: "sm",
  });

  if (!validEkatte) return null;

  return (
    <section aria-label="settlement-contracts" className="my-4">
      <ContractsAnalysisStrip
        sumAmountEur={agg.sumAmountEur}
        count={agg.count}
        singleBidPct={singleBidPct}
        directPct={directPct}
        groupedMethods={groupedMethods}
        procBucket={procBucket}
        onSelectBucket={setProcBucket}
        countLabel={t("company_contracts") || "Договори"}
      />

      <DbDataTable<ProcurementContract>
        resource="contracts"
        fixedFilters={fixedFilters}
        extraFilters={extraFilters}
        columns={columns}
        onData={handleData}
        defaultSort={[{ id: "date", desc: true }]}
        pageSize={25}
        initialSearch={params.get("q") ?? ""}
        searchPlaceholder={
          t("procurement_contracts_search") ||
          "Търси възложител / изпълнител / предмет…"
        }
        toolbar={
          <>
            {cpvOptions.length > 0 ? (
              <CpvFilterCombobox
                value={cpvDiv}
                onChange={setCpvDiv}
                divisions={cpvOptions}
                catalog={cpvCatalog ?? []}
                catalogError={cpvCatalogError}
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
