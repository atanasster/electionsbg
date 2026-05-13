// Contracts list tile for the company detail page. Lazy-fetches the full
// per-contractor contracts file and renders it through the project's pageable
// DataTable. Each row has an external link to the contract's data.egov.bg
// source (the OCDS dataset's release page or the legacy CSV's dataset page).

import { FC, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ExternalLink, Receipt } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { DataTable } from "@/ux/data_table/DataTable";
import { useContractorContracts } from "@/data/procurement/useContractorContracts";
import { resolveContractSource } from "../candidates/procurement/sourceUrl";
import type { ProcurementContract } from "@/data/dataTypes";

const FMT_EUR = new Intl.NumberFormat("bg-BG", { maximumFractionDigits: 0 });
const FMT_BGN = new Intl.NumberFormat("bg-BG", { maximumFractionDigits: 0 });

const formatAmount = (
  amount: number | undefined,
  currency: string | undefined,
): string => {
  if (amount == null || amount <= 0) return "—";
  const rounded = Math.round(amount);
  if (currency === "EUR") return `€${FMT_EUR.format(rounded)}`;
  if (currency === "BGN") return `${FMT_BGN.format(rounded)} лв`;
  if (!currency) return FMT_EUR.format(rounded);
  return `${FMT_EUR.format(rounded)} ${currency}`;
};

const tagBadgeClasses = (tag: ProcurementContract["tag"]): string => {
  if (tag === "contractAmendment")
    return "bg-amber-200/60 dark:bg-amber-800/40 text-amber-900 dark:text-amber-100";
  if (tag === "award")
    return "bg-slate-200/60 dark:bg-slate-700/40 text-slate-900 dark:text-slate-100";
  return "bg-emerald-200/60 dark:bg-emerald-800/40 text-emerald-900 dark:text-emerald-100";
};

export const CompanyContractsTile: FC<{ eik: string }> = ({ eik }) => {
  const { t } = useTranslation();
  const { data, isLoading } = useContractorContracts(eik);

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
        accessorKey: "awarderName",
        header: t("company_contract_awarder") || "Awarder",
        cell: ({ row }) => (
          <span className="text-sm">{row.original.awarderName}</span>
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
        cell: ({ row }) =>
          formatAmount(row.original.amount, row.original.currency),
        meta: { align: "right" },
        // Custom sort: numeric on raw amount (the cell renders formatted)
        sortingFn: (a, b) =>
          (a.original.amount ?? 0) - (b.original.amount ?? 0),
      },
      {
        id: "source",
        header: t("company_contract_source") || "Source",
        cell: ({ row }) => {
          const c = row.original;
          const src = resolveContractSource(c);
          return (
            <div className="flex items-center gap-2">
              {/* /procurement/contract/:key works only for the bounded
                  subset (top-N + MP-tied); for other rows the external link
                  is the canonical "see source". */}
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
                  src.label === "eop"
                    ? t("company_contract_open_eop") || "Open in CAIS ЕОП"
                    : t("company_contract_open_source") ||
                      "Open in data.egov.bg"
                }
              >
                {src.label === "eop" ? "ЕОП" : "egov"}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          );
        },
        enableSorting: false,
        meta: { exportable: false },
      },
    ],
    [t],
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
