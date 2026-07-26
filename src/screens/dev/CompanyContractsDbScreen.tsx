// DB-driven contracts / annexes drill-down for both entity sides:
// /company/:eik/contracts|annexes (scoped to contractor_eik) and
// /awarder/:eik/contracts (scoped to awarder_eik via side="awarder").
// Server-side paginated/sorted/filtered/aggregated via DbDataTable →
// /api/db/table (the `contracts` resource, tag fixed per route). Works for ANY
// company. Risk chips are scored client-side per page row (from the shared
// risk-indexes payload) — display only, since risk isn't a Postgres column.
// See docs/plans/pg-query-performance.md.

import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  cpvDivisionName,
  groupMethodFacet,
  procedureBucket,
  procedureLabel,
  type ProcedureBucket,
} from "@/lib/cpvSectors";
import { Receipt } from "lucide-react";
import { Title } from "@/ux/Title";
import { DbDataTable, type DbColumnFilter } from "@/ux/data_table/DbDataTable";
import type { DataTableColumnDef } from "@/ux/data_table/utils";
import { ContractAmount } from "@/screens/components/procurement/ContractAmount";
import { RiskBadges } from "@/screens/components/procurement/RiskBadges";
import { useContractRiskScorer } from "@/data/procurement/useContractRiskFlags";
import { ProcedureMixBar } from "@/screens/components/procurement/ProcedureMixBar";
import { formatEur } from "@/lib/currency";
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
const ALL = "__all__";

export const CompanyContractsDbScreen: FC<{
  tag: "contract" | "contractAmendment";
  /** Which side of the contract the :eik entity is on. "contractor" (default)
   *  lists what the company won; "awarder" lists what the state buyer paid. */
  side?: "contractor" | "awarder";
}> = ({ tag, side = "contractor" }) => {
  const { eik = "" } = useParams();
  const { t, i18n } = useTranslation();
  const { scoreRow } = useContractRiskScorer();

  const [year, setYear] = useState<string>(ALL);
  const [singleBidder, setSingleBidder] = useState(false);
  // Procedure filter is a ProcedureBucket key (null = all); the raw method
  // strings behind it are resolved from the grouped facet below.
  const [procBucket, setProcBucket] = useState<ProcedureBucket | null>(null);
  const [cpvDiv, setCpvDiv] = useState<string>(ALL);
  const [companyName, setCompanyName] = useState("");

  const isAwarder = side === "awarder";
  const scopeCol = isAwarder ? "awarder_eik" : "contractor_eik";
  const entityHref = isAwarder ? `/awarder/${eik}` : `/company/${eik}`;
  const isAnnex = tag === "contractAmendment";
  const heading = isAnnex ? "Анекси" : "Договори";

  // Entity name comes free on every row — grab it from the first loaded page,
  // no extra request.
  const handleData = useCallback(
    (resp: { rows: ProcurementContract[] }) => {
      const first = resp.rows[0];
      const name = isAwarder ? first?.awarderName : first?.contractorName;
      if (name) setCompanyName(name);
    },
    [isAwarder],
  );

  // Individual active-filter fragments, so each facet can apply every filter
  // EXCEPT its own dimension (a filter-scoped facet that still shows all its own
  // options — see /api/db/facets `filters` and ProcedureMixBar).
  const yearF = useMemo<DbColumnFilter[]>(
    () =>
      year !== ALL
        ? [{ id: "date", min: `${year}-01-01`, max: `${year}-12-31` }]
        : [],
    [year],
  );
  const singleF = useMemo<DbColumnFilter[]>(
    () => (singleBidder ? [{ id: "number_of_tenderers", min: 1, max: 1 }] : []),
    [singleBidder],
  );
  const cpvF = useMemo<DbColumnFilter[]>(
    () => (cpvDiv !== ALL ? [{ id: "cpv", value: cpvDiv }] : []),
    [cpvDiv],
  );

  const fetchFacets = async (
    columns: string[],
    filters: DbColumnFilter[],
  ): Promise<{
    facets: Record<string, { value: string; count: number }[]>;
  }> => {
    const req = {
      resource: "contracts",
      scope: { col: scopeCol, val: eik },
      fixedFilters: [{ id: "tag", value: [tag] }],
      filters,
      columns,
      limit: 100,
    };
    const r = await fetch(
      `/api/db/facets?q=${encodeURIComponent(JSON.stringify(req))}`,
    );
    if (!r.ok) return { facets: {} };
    return r.json();
  };

  // Procedure-mix facet — every filter EXCEPT the procedure one, so all buckets
  // stay visible (the bar/dropdown never collapse to just the selected bucket).
  const { data: procFacet } = useQuery({
    queryKey: [
      "db-facets",
      "contracts",
      eik,
      tag,
      side,
      "proc",
      yearF,
      singleF,
      cpvF,
    ],
    queryFn: () =>
      fetchFacets(["procurement_method"], [...yearF, ...singleF, ...cpvF]),
    staleTime: Infinity,
  });
  const groupedMethods = useMemo(
    () => groupMethodFacet(procFacet?.facets?.procurement_method ?? []),
    [procFacet],
  );
  // Raw method strings behind the selected bucket → the `in` filter payload.
  const selectedMethods = useMemo<string[]>(
    () =>
      procBucket
        ? (groupedMethods.find((g) => g.bucket === procBucket)?.methods ?? [])
        : [],
    [procBucket, groupedMethods],
  );
  const methodF = useMemo<DbColumnFilter[]>(
    () =>
      selectedMethods.length
        ? [{ id: "procurement_method", value: selectedMethods }]
        : [],
    [selectedMethods],
  );
  // If another filter (year/CPV/single-bid) narrows the scoped facet so the
  // selected bucket no longer exists, `selectedMethods` would silently become []
  // and the procedure filter would drop while the UI still reads "selected".
  // Clear the stale selection once the facet has loaded so the state stays honest.
  useEffect(() => {
    if (
      procBucket &&
      groupedMethods.length &&
      !groupedMethods.some((g) => g.bucket === procBucket)
    ) {
      setProcBucket(null);
    }
  }, [procBucket, groupedMethods]);

  // CPV facet — every filter EXCEPT the CPV one, for the same reason.
  const { data: cpvFacet } = useQuery({
    queryKey: [
      "db-facets",
      "contracts",
      eik,
      tag,
      side,
      "cpv",
      yearF,
      singleF,
      methodF,
    ],
    queryFn: () => fetchFacets(["cpv"], [...yearF, ...singleF, ...methodF]),
    staleTime: Infinity,
  });
  const cpvOptions = cpvFacet?.facets?.cpv ?? [];

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
        cell: ({ row }) => <RiskBadges result={scoreRow(row.original)} />,
      },
      // The source column was removed: "Детайли" duplicated the subject link
      // (both → /procurement/contract/:key) and the external ЕОП/egov link lives
      // on that detail screen (ContractDetailScreen).
    ],
    [t, i18n.language, scoreRow, isAwarder],
  );

  return (
    <>
      <Title description={`${heading} — ${companyName || `ЕИК ${eik}`}`}>
        {heading}
      </Title>
      <section aria-label={heading} className="w-full px-4 py-6 md:px-6">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Receipt className="h-4 w-4 shrink-0" />
          <Link
            to={entityHref}
            className="font-medium text-foreground hover:underline"
          >
            {companyName || `ЕИК ${eik}`}
          </Link>
          <span>· ЕИК {eik}</span>
        </div>

        {/* Procedure-mix overview — filter-scoped (reflects the active year / CPV
            / single-bid filters, excluding the procedure dimension itself) and
            clickable: a segment/chip toggles the same bucket filter as the
            dropdown. */}
        <div className="mb-4">
          <ProcedureMixBar
            buckets={groupedMethods}
            selected={procBucket}
            onSelect={setProcBucket}
            title={t("contracts_procedure_mix") || "Вид процедура"}
            note={
              t("contracts_procedure_mix_note") ||
              "Дял от договорите с посочена процедура."
            }
          />
        </div>

        <DbDataTable<ProcurementContract>
          resource="contracts"
          scope={{ col: scopeCol, val: eik }}
          fixedFilters={[{ id: "tag", value: [tag] }]}
          extraFilters={extraFilters}
          columns={columns}
          onData={handleData}
          defaultSort={[{ id: "date", desc: true }]}
          pageSize={25}
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
                  <SelectItem value={ALL}>
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
                    <SelectItem value={ALL}>
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
              {groupedMethods.length > 0 ? (
                <Select
                  value={procBucket ?? ALL}
                  onValueChange={(v) =>
                    setProcBucket(v === ALL ? null : (v as ProcedureBucket))
                  }
                >
                  <SelectTrigger className="w-auto h-9 max-w-[220px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>
                      {t("company_contracts_all_procedures") ||
                        "Всички процедури"}
                    </SelectItem>
                    {groupedMethods.map((g) => (
                      <SelectItem key={g.bucket} value={g.bucket}>
                        {procedureLabel(g.bucket, i18n.language)} ({g.count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={singleBidder}
                  onChange={(e) => setSingleBidder(e.target.checked)}
                />
                {t("company_contracts_single_bidder") || "само 1 оферта"}
              </label>
            </>
          }
          renderAggregates={(agg, total, exact) => (
            <span className="text-sm text-muted-foreground">
              <span className="font-semibold tabular-nums text-foreground">
                {formatEur(agg.sumAmountEur ?? 0)}
              </span>{" "}
              {t("company_contracts_total_over") || "по"}{" "}
              <span className="tabular-nums">
                {exact ? "" : "≈"}
                {(agg.count ?? total).toLocaleString("bg-BG")}
              </span>{" "}
              {isAnnex ? "анекса" : "договора"}
            </span>
          )}
        />
      </section>
    </>
  );
};
