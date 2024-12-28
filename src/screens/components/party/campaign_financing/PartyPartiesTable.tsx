import { FinancingFromParties } from "@/data/dataTypes";
import { DataTable, DataTableColumns } from "@/ux/data_table/DataTable";
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
        dataType: "money",
        header: t("non_monetary"),
      },
      {
        accessorKey: "monetary",
        dataType: "money",
        header: t("monetary"),
      },
      {
        accessorKey: "totalIncome",
        dataType: "money",
        header: t("total"),
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
      title={t("parties")}
      pageSize={25}
      columns={columns}
      stickyColumn={true}
      data={tableData}
    />
  );
};
