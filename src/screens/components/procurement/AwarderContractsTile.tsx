// Contracts list tile for the awarder detail page. Mirrors
// CompanyContractsTile but renders the contractor column (who got paid)
// rather than the awarder column.

import { FC, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ExternalLink, Receipt } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { DataTable } from "@/ux/data_table/DataTable";
import { useAwarderContracts } from "@/data/procurement/useAwarder";
import { useContractRiskScorer } from "@/data/procurement/useContractRiskFlags";
import { resolveContractSource } from "../candidates/procurement/sourceUrl";
import type { ProcurementContract } from "@/data/dataTypes";
import { ContractAmount } from "./ContractAmount";
import { RiskBadges } from "./RiskBadges";

const tagBadgeClasses = (tag: ProcurementContract["tag"]): string => {
  if (tag === "contractAmendment")
    return "bg-amber-200/60 dark:bg-amber-800/40 text-amber-900 dark:text-amber-100";
  if (tag === "award")
    return "bg-slate-200/60 dark:bg-slate-700/40 text-slate-900 dark:text-slate-100";
  return "bg-emerald-200/60 dark:bg-emerald-800/40 text-emerald-900 dark:text-emerald-100";
};

export const AwarderContractsTile: FC<{ eik: string }> = ({ eik }) => {
  const { t } = useTranslation();
  const { data, isLoading } = useAwarderContracts(eik);
  const { scoreRow } = useContractRiskScorer();

  const columns = useMemo<ColumnDef<ProcurementContract>[]>(
    () => [
      {
        accessorKey: "date",
        header: t("company_contract_date") || "Date",
        cell: ({ row }) => (
          <div className="tabular-nums">
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
      {
        accessorKey: "tag",
        header: t("company_contract_tag") || "Type",
        cell: ({ row }) => (
          <span
            className={`inline-block rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${tagBadgeClasses(row.original.tag)}`}
          >
            {row.original.tag === "contractAmendment"
              ? t("contract_tag_amendment") || "Amendment"
              : row.original.tag === "award"
                ? t("contract_tag_award") || "Award"
                : t("contract_tag_contract") || "Contract"}
          </span>
        ),
      },
      {
        accessorKey: "contractorName",
        header: t("awarder_contract_contractor") || "Contractor",
        cell: ({ row }) => (
          <Link
            to={`/company/${row.original.contractorEik}`}
            className="text-sm hover:underline"
          >
            {row.original.contractorName}
          </Link>
        ),
      },
      {
        accessorKey: "title",
        header: t("company_contract_subject") || "Subject",
        cell: ({ row }) => (
          <span className="text-sm line-clamp-2 max-w-md inline-block">
            {row.original.title || "—"}
          </span>
        ),
      },
      {
        accessorKey: "amount",
        header: t("company_contract_amount") || "Amount",
        cell: ({ row }) => (
          <ContractAmount
            amountEur={row.original.amountEur}
            amount={row.original.amount}
            currency={row.original.currency}
          />
        ),
        meta: { align: "right" },
        sortingFn: (a, b) =>
          (a.original.amountEur ?? a.original.amount ?? 0) -
          (b.original.amountEur ?? b.original.amount ?? 0),
      },
      {
        id: "risk",
        header: t("company_contract_risk") || "Risk",
        accessorFn: (row) => scoreRow(row).score,
        cell: ({ row }) => (
          <RiskBadges result={scoreRow(row.original)} showScore />
        ),
        sortingFn: (a, b) =>
          scoreRow(a.original).score - scoreRow(b.original).score,
        meta: { align: "left" },
      },
      {
        id: "source",
        header: t("company_contract_source") || "Source",
        cell: ({ row }) => {
          const c = row.original;
          const src = resolveContractSource(c);
          return (
            <div className="flex items-center gap-2">
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
                title={
                  src.label === "egov"
                    ? t("company_contract_open_source") ||
                      "Open in data.egov.bg"
                    : t("company_contract_open_eop") || "Open in CAIS ЕОП"
                }
              >
                {src.label === "egov" ? "egov" : "ЕОП"}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          );
        },
        enableSorting: false,
        meta: { exportable: false },
      },
    ],
    [t, scoreRow],
  );

  if (isLoading) {
    return (
      <Card className="my-4" aria-hidden>
        <CardContent>
          <div className="min-h-[500px]" />
        </CardContent>
      </Card>
    );
  }
  if (!data || data.contracts.length === 0) return null;

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Receipt className="h-4 w-4" />
          {t("company_contracts_title") || "Contracts"}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {data.count.toLocaleString("bg-BG")}{" "}
            {t("company_contracts_count") || "rows"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <DataTable
          columns={columns}
          data={data.contracts}
          pageSize={25}
          initialSort={[{ id: "date", desc: true }]}
        />
      </CardContent>
    </Card>
  );
};
