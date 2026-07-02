// /procurement/awarders — full pageable list of top awarding bodies,
// DB-backed (/api/db/procurement-rankings) and scoped to the current
// procurement window (?pscope: the selected parliament, or the full corpus).

import { FC, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Building2 } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/ux/data_table/DataTable";
import { Title } from "@/ux/Title";
import { useProcurementRankings } from "@/data/procurement/useProcurementRankings";
import { FollowStar } from "@/screens/components/procurement/FollowStar";
import type { ProcurementByNsTopAwarder } from "@/data/dataTypes";

const formatEur = new Intl.NumberFormat("bg-BG", { maximumFractionDigits: 0 });

export const TopAwardersScreen: FC = () => {
  const { t } = useTranslation();
  const { data, isLoading } = useProcurementRankings();

  const columns = useMemo<ColumnDef<ProcurementByNsTopAwarder>[]>(
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
        header: t("procurement_col_awarder") || "Awarder",
        cell: ({ row }) => (
          <div className="flex items-center gap-2 flex-wrap">
            <FollowStar
              kind="awarder"
              id={row.original.eik}
              label={row.original.name}
              className="shrink-0"
            />
            <Link
              to={`/awarder/${row.original.eik}`}
              className="font-medium hover:underline"
            >
              {row.original.name}
            </Link>
            <span className="text-xs text-muted-foreground">
              {row.original.eik}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "totalEur",
        header: t("procurement_index_col_total") || "Total",
        cell: ({ row }) =>
          `€${formatEur.format(Math.round(row.original.totalEur))}`,
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
      <Title description="Top procurement awarders for the selected parliament">
        {t("procurement_top_awarders") || "Top awarders"}
      </Title>
      <section aria-label="top-awarders" className="my-4">
        <div className="flex items-center gap-2 mb-2 text-sm text-muted-foreground">
          <Building2 className="h-4 w-4" />
          {t("procurement_top_awarders_subtitle") ||
            "State buyers ranked by total contract value (EUR-converted)."}
          {data?.start ? (
            <span className="ml-2">
              · {data.start}
              {data.end ? `…${data.end}` : ` …`}
            </span>
          ) : null}
        </div>
        {isLoading || !data ? (
          <div className="min-h-[600px]" aria-hidden />
        ) : (
          <DataTable
            columns={columns}
            data={data.topAwarders}
            pageSize={25}
            initialSort={[{ id: "totalEur", desc: true }]}
          />
        )}
      </section>
    </>
  );
};
