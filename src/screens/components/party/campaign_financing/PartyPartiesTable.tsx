import { FinancingFromParties } from "@/data/dataTypes";
import { formatThousands } from "@/data/utils";
import { DataTable, DataTableColumns } from "@/ux/DataTable";
import { Hint } from "@/ux/Hint";
import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";

type TableData = FinancingFromParties & {
  totalIncome: number;
};
export const PartyPartiesTable: FC<{ data: FinancingFromParties[] }> = ({
  data,
}) => {
  const { t } = useTranslation();
  const columns: DataTableColumns<TableData, unknown> = useMemo(
    () => [
      {
        accessorKey: "name",
        header: t("party"),
      },
      {
        accessorKey: "nonMonetary",
        header: (
          <Hint text={t("pct_party_votes_explainer")}>
            <div>{t("non_monetary")}</div>
          </Hint>
        ) as never,
        className: "text-right",
        cell: ({ row }) => formatThousands(row.original.nonMonetary, 0),
      },
      {
        accessorKey: "monetary",
        header: (
          <Hint text={t("pct_party_votes_explainer")}>
            <div>{t("monetary")}</div>
          </Hint>
        ) as never,
        className: "text-right",
        cell: ({ row }) => formatThousands(row.original.monetary, 0),
      },
      {
        accessorKey: "totalIncome",
        header: (
          <Hint text={t("pct_party_votes_explainer")}>
            <div>{t("total")}</div>
          </Hint>
        ) as never,
        className: "text-right",
        cell: ({ row }) => formatThousands(row.original.totalIncome, 0),
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
