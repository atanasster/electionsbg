// DB-driven contracts / annexes drill-down for both entity sides:
// /company/:eik/contracts|annexes (scoped to contractor_eik) and
// /awarder/:eik/contracts (scoped to awarder_eik via side="awarder").
// Server-side paginated/sorted/filtered/aggregated via DbDataTable →
// /api/db/table (the `contracts` resource, tag fixed per route). Works for ANY
// company. Risk chips are scored client-side per page row (from the shared
// risk-indexes payload) — display only, since risk isn't a Postgres column.
// See docs/plans/pg-query-performance.md.

import { FC, useCallback, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { cpvDivisionName } from "@/lib/cpvSectors";
import { Receipt, ExternalLink } from "lucide-react";
import { Title } from "@/ux/Title";
import { DbDataTable, type DbColumnFilter } from "@/ux/data_table/DbDataTable";
import type { DataTableColumnDef } from "@/ux/data_table/utils";
import { ContractAmount } from "@/screens/components/procurement/ContractAmount";
import { RiskBadges } from "@/screens/components/procurement/RiskBadges";
import { useContractRiskScorer } from "@/data/procurement/useContractRiskFlags";
import { resolveContractSource } from "@/screens/components/candidates/procurement/sourceUrl";
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
  const [method, setMethod] = useState<string>(ALL);
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

  // Facet options (distinct methods + CPV divisions for THIS company), scoped +
  // tag-fixed so the dropdowns are stable regardless of the other selections.
  const { data: facetData } = useQuery({
    queryKey: ["db-facets", "contracts", eik, tag, side],
    queryFn: async (): Promise<{
      facets: Record<string, { value: string; count: number }[]>;
    }> => {
      const req = {
        resource: "contracts",
        scope: { col: scopeCol, val: eik },
        fixedFilters: [{ id: "tag", value: [tag] }],
        columns: ["procurement_method", "cpv"],
        limit: 100,
      };
      const r = await fetch(
        `/api/db/facets?q=${encodeURIComponent(JSON.stringify(req))}`,
      );
      if (!r.ok) return { facets: {} };
      return r.json();
    },
    staleTime: Infinity,
  });
  const methodOptions = facetData?.facets?.procurement_method ?? [];
  const cpvOptions = facetData?.facets?.cpv ?? [];

  const extraFilters = useMemo<DbColumnFilter[]>(() => {
    const f: DbColumnFilter[] = [];
    if (year !== ALL)
      f.push({ id: "date", min: `${year}-01-01`, max: `${year}-12-31` });
    if (singleBidder) f.push({ id: "number_of_tenderers", min: 1, max: 1 });
    if (method !== ALL) f.push({ id: "procurement_method", value: [method] });
    if (cpvDiv !== ALL) f.push({ id: "cpv", value: cpvDiv });
    return f;
  }, [year, singleBidder, method, cpvDiv]);

  const columns = useMemo<DataTableColumnDef<ProcurementContract, unknown>[]>(
    () => [
      {
        id: "date",
        accessorFn: (r) => r.date,
        header: t("company_contract_date") || "Date",
        cell: ({ row }) => (
          <div className="tabular-nums whitespace-nowrap">
            <div>{row.original.date}</div>
            {row.original.dateSigned &&
            row.original.dateSigned !== row.original.date ? (
              <div className="text-xs text-muted-foreground">
                {t("company_contract_signed") || "signed"}:{" "}
                {row.original.dateSigned}
              </div>
            ) : null}
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
          <span className="text-sm line-clamp-2 max-w-md inline-block">
            {row.original.title || "—"}
          </span>
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
              <ContractAmount amountEur={row.original.consortiumFullEur} />
            </span>
          ) : null,
      },
      {
        id: "risk",
        header: t("company_contract_risk") || "Flags",
        enableSorting: false,
        cell: ({ row }) => <RiskBadges result={scoreRow(row.original)} />,
      },
      {
        id: "source",
        header: t("company_contract_source") || "Source",
        enableSorting: false,
        cell: ({ row }) => {
          const c = row.original;
          const src = resolveContractSource(c);
          return (
            <div className="flex items-center gap-2 whitespace-nowrap">
              <Link
                to={`/procurement/contract/${c.key}`}
                className="text-xs text-primary hover:underline"
              >
                {t("company_contract_details") || "Details"}
              </Link>
              <a
                href={src.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-0.5"
              >
                {src.label === "egov" ? "egov" : "ЕОП"}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          );
        },
      },
    ],
    [t, scoreRow, isAwarder],
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
              {methodOptions.length > 0 ? (
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger className="w-auto h-9 max-w-[220px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>
                      {t("company_contracts_all_methods") || "Всички процедури"}
                    </SelectItem>
                    {methodOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.value} ({o.count})
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
