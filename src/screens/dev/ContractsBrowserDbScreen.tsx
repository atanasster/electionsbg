// Global public-procurement contracts browser (/procurement/contracts), DB-fed.
// A server-side paginated/sorted/filtered DbDataTable over the whole `contracts`
// corpus (no entity scope) — replaces the client-side contract_index/{year}.json
// shards. Respects the section scope (?pscope): the selected parliament's window
// bounds the rows, "all" spans the corpus. Risk chips are scored client-side per
// page (risk isn't a Postgres column). See docs/plans/postgres-migration-v1.md.

import { FC, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Receipt, ExternalLink } from "lucide-react";
import { Title } from "@/ux/Title";
import { DbDataTable, type DbColumnFilter } from "@/ux/data_table/DbDataTable";
import type { DataTableColumnDef } from "@/ux/data_table/utils";
import { ProcurementSectionHeader } from "@/screens/components/procurement/ProcurementSectionHeader";
import { ContractAmount } from "@/screens/components/procurement/ContractAmount";
import { RiskBadges } from "@/screens/components/procurement/RiskBadges";
import { useContractRiskScorer } from "@/data/procurement/useContractRiskFlags";
import { useProcurementWindow } from "@/data/procurement/useProcurementWindow";
import { resolveContractSource } from "@/screens/components/candidates/procurement/sourceUrl";
import { cpvDivisionName } from "@/lib/cpvSectors";
import { formatEur } from "@/lib/currency";
import { decodeEntities } from "@/lib/decodeEntities";
import type { ProcurementContract } from "@/data/dataTypes";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL = "__all__";

export const ContractsBrowserDbScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const { scoreRow } = useContractRiskScorer();
  const { from, to, all, year } = useProcurementWindow();
  // ?q= deep link (combined-search "see all" footer) seeds the search box.
  const [params] = useSearchParams();

  const [method, setMethod] = useState<string>(ALL);
  const [cpvDiv, setCpvDiv] = useState<string>(ALL);
  const [singleBidder, setSingleBidder] = useState(false);

  // The parliament window is the base temporal bound (exclusive end ≈ inclusive
  // max, off by ≤1 day — fine for a browser). "All years" drops it.
  const windowFilter = useMemo<DbColumnFilter[]>(
    () =>
      !all && from ? [{ id: "date", min: from, max: to ?? undefined }] : [],
    [all, from, to],
  );

  // Facet dropdowns (methods + CPV divisions) bounded to the current window so
  // the corpus-wide DISTINCT stays cheap.
  const { data: facetData } = useQuery({
    queryKey: ["db-facets", "contracts-global", from, to, all],
    queryFn: async (): Promise<{
      facets: Record<string, { value: string; count: number }[]>;
    }> => {
      const req = {
        resource: "contracts",
        fixedFilters: [{ id: "tag", value: ["contract"] }, ...windowFilter],
        columns: ["procurement_method", "cpv"],
        limit: 60,
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
    const f: DbColumnFilter[] = [...windowFilter];
    if (singleBidder) f.push({ id: "number_of_tenderers", min: 1, max: 1 });
    if (method !== ALL) f.push({ id: "procurement_method", value: [method] });
    if (cpvDiv !== ALL) f.push({ id: "cpv", value: cpvDiv });
    return f;
  }, [windowFilter, singleBidder, method, cpvDiv]);

  const columns = useMemo<DataTableColumnDef<ProcurementContract, unknown>[]>(
    () => [
      {
        id: "date",
        accessorFn: (r) => r.date,
        header: t("company_contract_date") || "Date",
        cell: ({ row }) => (
          <div className="tabular-nums whitespace-nowrap">
            {row.original.date}
          </div>
        ),
      },
      {
        id: "awarder_name",
        accessorFn: (r) => r.awarderName,
        header: t("company_contract_awarder") || "Awarder",
        enableSorting: false,
        cell: ({ row }) => (
          <Link
            to={`/company/${row.original.awarderEik}`}
            className="text-sm hover:underline"
          >
            {decodeEntities(row.original.awarderName)}
          </Link>
        ),
      },
      {
        id: "contractor_name",
        accessorFn: (r) => r.contractorName,
        header: t("company_contract_contractor") || "Contractor",
        enableSorting: false,
        cell: ({ row }) => (
          <Link
            to={`/company/${row.original.contractorEik}`}
            className="text-sm font-medium hover:underline"
          >
            {decodeEntities(row.original.contractorName)}
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
            className="text-sm line-clamp-2 max-w-sm inline-block hover:text-primary hover:underline"
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
        id: "risk",
        header: t("company_contract_risk") || "Risk",
        enableSorting: false,
        cell: ({ row }) => (
          <RiskBadges result={scoreRow(row.original)} showScore />
        ),
      },
      {
        id: "source",
        header: t("company_contract_source") || "Source",
        enableSorting: false,
        cell: ({ row }) => {
          const src = resolveContractSource(row.original);
          return (
            <a
              href={src.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-0.5"
            >
              {src.label === "egov" ? "egov" : "ЕОП"}
              <ExternalLink className="h-3 w-3" />
            </a>
          );
        },
      },
    ],
    [t, scoreRow],
  );

  return (
    <>
      <Title description="Public-procurement contracts, searchable across the whole corpus.">
        {t("procurement_contracts_title") || "Contracts"}
      </Title>
      <ProcurementSectionHeader scopeMode="toggle" />
      <section aria-label="contracts" className="my-4">
        <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Receipt className="h-4 w-4 shrink-0" />
          {all
            ? t("procurement_scope_all") || "Full corpus, all years."
            : year != null
              ? t("procurement_scope_year", { year }) ||
                `Showing contracts signed in ${year}.`
              : `${from ?? ""}${to ? ` → ${to}` : " → …"}`}
        </div>

        <DbDataTable<ProcurementContract>
          resource="contracts"
          fixedFilters={[{ id: "tag", value: ["contract"] }]}
          extraFilters={extraFilters}
          columns={columns}
          defaultSort={[{ id: "amount_eur", desc: true }]}
          pageSize={25}
          initialSearch={params.get("q") ?? ""}
          searchPlaceholder={
            t("procurement_contracts_search") ||
            "Търси възложител / изпълнител / предмет…"
          }
          toolbar={
            <>
              {cpvOptions.length > 0 ? (
                <Select value={cpvDiv} onValueChange={setCpvDiv}>
                  <SelectTrigger className="w-auto h-9 max-w-[220px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>
                      {t("company_contracts_all_cpv") || "Всички сектори (CPV)"}
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
              {t("procurement_contracts_word") || "договора"}
            </span>
          )}
        />
      </section>
    </>
  );
};
