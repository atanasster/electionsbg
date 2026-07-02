// /procurement/mps — full pageable list of MPs ranked by procurement awarded
// to their connected companies, DB-backed (/api/db/procurement-rankings) and
// scoped to the current procurement window (?pscope).

import { FC, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/ux/data_table/DataTable";
import { Title } from "@/ux/Title";
import { useProcurementRankings } from "@/data/procurement/useProcurementRankings";
import type { ProcurementByNsTopMp } from "@/data/dataTypes";
import { MpAvatar } from "./components/candidates/MpAvatar";
import { ConfidenceBadge } from "./components/connections/ConfidenceBadge";

const formatEur = new Intl.NumberFormat("bg-BG", { maximumFractionDigits: 0 });

export const TopMpsScreen: FC = () => {
  const { t } = useTranslation();
  const { data, isLoading } = useProcurementRankings();

  const columns = useMemo<ColumnDef<ProcurementByNsTopMp>[]>(
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
        accessorKey: "mpName",
        header: t("procurement_col_mp") || "MP",
        cell: ({ row }) => {
          const e = row.original;
          return (
            <div>
              <span className="inline-flex items-center gap-2">
                <Link
                  to={`/candidate/mp-${e.mpId}#mp-procurement`}
                  className="font-medium hover:underline inline-flex items-center gap-2"
                >
                  <MpAvatar mpId={e.mpId} name={e.mpName} />
                  {e.mpName}
                </Link>
                {e.confidence === "medium" ? (
                  <ConfidenceBadge confidence="medium" showHigh={false} />
                ) : null}
              </span>
              {e.topContractorNames.length > 0 ? (
                <div className="text-xs text-muted-foreground truncate max-w-md">
                  {e.topContractorNames.join(", ")}
                </div>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: "totalEur",
        header: t("procurement_index_col_total") || "Total",
        cell: ({ row }) =>
          `€${formatEur.format(Math.round(row.original.totalEur))}`,
        meta: { align: "right" },
      },
      {
        accessorKey: "contractorCount",
        header: t("procurement_col_companies") || "Companies",
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
      <Title description="Top MPs by procurement awarded to their connected companies in the selected parliament">
        {t("procurement_top_mps") || "Top MPs by connected procurement"}
      </Title>
      <section aria-label="top-mps" className="my-4">
        <div className="flex items-center gap-2 mb-2 text-sm text-muted-foreground">
          <Users className="h-4 w-4 text-amber-600" />
          {t("procurement_top_mps_subtitle") ||
            "MPs whose declared business interests received the most procurement in the period."}
          {data && (data.start || data.end) ? (
            <span className="ml-2">
              · {data.start ?? ""}
              {data.end ? `…${data.end}` : ` …`}
            </span>
          ) : null}
        </div>
        {isLoading ? (
          <div className="min-h-[600px]" aria-hidden />
        ) : !data ? (
          <p className="text-sm text-muted-foreground">
            {t("data_load_failed") ||
              "The data could not be loaded — please try again shortly."}
          </p>
        ) : (
          <DataTable
            columns={columns}
            data={data.topMps}
            pageSize={25}
            initialSort={[{ id: "totalEur", desc: true }]}
          />
        )}
      </section>
    </>
  );
};
