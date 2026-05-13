// /procurement/contractors — standalone full table of all top contractors.
// Uses the project's pageable DataTable so the operator can sort, filter,
// page, and export. Bounded by the top-N cap built into top_contractors.json
// (default 1000) which is plenty for the SPA's per-page needs.

import { FC, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Receipt } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/ux/data_table/DataTable";
import { Title } from "@/ux/Title";
import { useTopContractors } from "@/data/procurement/useProcurementIndex";
import type { ProcurementTopContractorEntry } from "@/data/dataTypes";
import { formatTotalAsEur } from "./components/candidates/procurement/formatAmount";

export const TopContractorsScreen: FC = () => {
  const { t } = useTranslation();
  const { data, isLoading } = useTopContractors();

  const columns = useMemo<ColumnDef<ProcurementTopContractorEntry>[]>(
    () => [
      {
        id: "rank",
        header: "#",
        cell: ({ row, table }) =>
          table.getState().pagination.pageIndex *
            table.getState().pagination.pageSize +
          row.index +
          1,
        enableSorting: false,
        meta: { exportable: false },
      },
      {
        accessorKey: "name",
        header: t("procurement_index_col_contractor") || "Contractor",
        cell: ({ row }) => {
          const e = row.original;
          return (
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                to={`/company/${e.eik}`}
                className="font-medium hover:underline"
              >
                {e.name}
              </Link>
              <span className="text-xs text-muted-foreground">{e.eik}</span>
              {e.mpTied ? (
                <span className="inline-block rounded bg-amber-200/60 dark:bg-amber-800/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                  {t("procurement_index_mp_tag") || "MP-tied"}
                </span>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "total",
        // Sort by raw sum across currencies — see formatAmount caveat. The
        // displayed cell preserves the per-currency split.
        accessorFn: (row) =>
          Object.values(row.totalByCurrency).reduce((s, n) => s + n, 0),
        header: t("procurement_index_col_total") || "Total",
        cell: ({ row }) =>
          formatTotalAsEur(row.original.totalByCurrency) || "—",
        meta: { align: "right" },
      },
      {
        accessorKey: "contractCount",
        header: t("procurement_index_col_contracts") || "Contracts",
        meta: { align: "right" },
      },
    ],
    [t],
  );

  return (
    <>
      <Title description="Top procurement contractors ranked by total amount across the corpus">
        {t("procurement_index_top_contractors") || "Top contractors"}
      </Title>
      <section aria-label="top-contractors" className="my-4">
        <div className="flex items-center gap-2 mb-2 text-sm text-muted-foreground">
          <Receipt className="h-4 w-4" />
          {t("procurement_index_top_subtitle") ||
            "Sorted by total amount. MP-tied contractors are highlighted."}
        </div>
        {isLoading || !data ? (
          <div className="min-h-[600px]" aria-hidden />
        ) : (
          <DataTable
            columns={columns}
            data={data.entries}
            pageSize={25}
            initialSort={[{ id: "total", desc: true }]}
          />
        )}
      </section>
    </>
  );
};
