// The contracts browser on /procurement/settlement/:ekatte — every contract awarded by a
// buyer SEATED in this settlement. A thin wrapper over the shared ContractsBrowserSection: it
// supplies the settlement identity (the `awarder_ekatte` semi-join) and the window; the strip,
// filters, columns and footer all live in the shared body.
//
// Scoped server-side by the `awarder_ekatte` semi-join (functions/db_table.js): contracts
// carries no place column, so "procurement in Варна" is "every contract whose awarder is
// seated at this EKATTE". Nothing here resolves that buyer set client-side.
//
// ⚠ THE TWO DATE CONVENTIONS. This section and the page's KPI cards answer the same question
// through different SQL, so their windows must line up exactly:
//   • the KPI cards read procurement_settlement_detail, which is HALF-OPEN (date < to) —
//     useScopeWindow's pair, passed verbatim;
//   • this table's `date` range filter is INCLUSIVE (date <= max) — so it takes scopeRange's
//     pair, whose upper bound is already the day before.
// Both derive from the SAME scope, so they cannot drift. See procurement_settlement_scope.data.test.ts.
//
// ⚠ `awarder_ekatte` is a `required` semi-join, so a malformed value 400s. The guard here
// returns null BEFORE mounting the shared body — otherwise its facet queries would fire an
// empty, rejected request. Refuse both halves together rather than half-failing.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import {
  ContractsBrowserSection,
  type ContractsBrowserSectionProps,
} from "@/screens/components/procurement/ContractsBrowserSection";
import type { DbColumnFilter } from "@/ux/data_table/DbDataTable";
import { useScope } from "@/data/scope/useScope";
import { scopeRange } from "@/data/scope/scopeRange";
import { useElectionContext } from "@/data/ElectionContext";

// Both parties: a settlement spans many buyers, so neither side is implied by the page the way
// it is on /company/:eik or /awarder/:eik. No `source` column — the subject already links to
// the contract page, where the external link lives.
const SETTLEMENT_COLUMNS: ContractsBrowserSectionProps["columns"] = [
  "date",
  "awarder_name",
  "contractor_name",
  "title",
  "amount_eur",
  "procedure",
  "number_of_tenderers",
  "consortium_full_eur",
  "risk_cri",
];

export const ProcurementSettlementContractsSection: FC<{ ekatte: string }> = ({
  ekatte,
}) => {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const validEkatte = /^\d{5}$/.test(ekatte);
  const { scope } = useScope();
  const { selected } = useElectionContext();

  // INCLUSIVE bounds — see the header note. `scopeRange` is the shared helper the
  // awarder/company dashboards already use for the `date <= to` endpoints.
  const dateWindow = useMemo(
    () => scopeRange(scope, selected),
    [scope, selected],
  );
  const placeScope = useMemo<DbColumnFilter[]>(
    () => [{ id: "awarder_ekatte", value: ekatte }],
    [ekatte],
  );

  if (!validEkatte) return null;

  return (
    <ContractsBrowserSection
      scope={placeScope}
      dateWindow={dateWindow}
      resetKey={ekatte}
      ariaLabel="settlement-contracts"
      columns={SETTLEMENT_COLUMNS}
      countLabel={t("company_contracts") || "Договори"}
      initialSearch={params.get("q") ?? ""}
    />
  );
};
