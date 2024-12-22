import { FinancingFromDonors } from "@/data/dataTypes";
import { formatThousands } from "@/data/utils";
import { DataTable, DataTableColumns } from "@/ux/DataTable";
import { Hint } from "@/ux/Hint";
import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";

type TableData = FinancingFromDonors & {
  totalIncome: number;
};
export const PartyDonorsTable: FC<{ data: FinancingFromDonors[] }> = ({
  data,
}) => {
  const { t } = useTranslation();
  const columns: DataTableColumns<TableData, unknown> = useMemo(
    () => [
      {
        accessorKey: "name",
        header: t("name"),
      },
      {
        accessorKey: "date",
        header: t("date"),
      },
      {
        accessorKey: "goal",
        header: t("goal"),
      },
      {
        accessorKey: "party",
        header: t("party"),
      },

      {
        accessorKey: "nonMonetary",
        header: (
          <Hint text={t("pct_party_votes_explainer")}>
            <div>{t("non_monetary")}</div>
          </Hint>
        ) as never,
        cell: ({ row }) => {
          return (
            <div className="px-4 py-2 text-right">
              {formatThousands(row.original.nonMonetary, 0)}
            </div>
          );
        },
      },
      {
        accessorKey: "monetary",
        header: (
          <Hint text={t("pct_party_votes_explainer")}>
            <div>{t("monetary")}</div>
          </Hint>
        ) as never,
        cell: ({ row }) => {
          return (
            <div className="px-4 py-2 text-right">
              {formatThousands(row.original.monetary, 0)}
            </div>
          );
        },
      },
      {
        accessorKey: "totalIncome",
        header: (
          <Hint text={t("pct_party_votes_explainer")}>
            <div>{t("total")}</div>
          </Hint>
        ) as never,
        cell: ({ row }) => {
          return (
            <div className="px-4 py-2 text-right">
              {formatThousands(row.original.totalIncome, 0)}
            </div>
          );
        },
      },
    ],
    [t],
  );
  const tableData = useMemo(
    () =>
      data
        ?.map((d) => ({
          ...d,
          totalIncome: d.monetary | d.nonMonetary,
        }))
        .sort((a, b) => b.totalIncome - a.totalIncome) || [],
    [data],
  );
  return (
    <DataTable<TableData, unknown>
      pageSize={25}
      columns={columns}
      stickyColumn={true}
      data={tableData}
    />
  );
};
