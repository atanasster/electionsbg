import { FinancingFromDonors } from "@/data/dataTypes";
import { DataTable, DataTableColumns } from "@/ux/data_table/DataTable";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";

type TableData = FinancingFromDonors & {
  totalAmount: number;
  items?: TableData[];
};
export const PartyDonorsTable: FC<{ data: FinancingFromDonors[] }> = ({
  data,
}) => {
  const { t } = useTranslation();
  const isMedium = useMediaQueryMatch("md");
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
        hidden: !isMedium,
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
        accessorKey: "totalAmount",
        dataType: "money",
        header: t("total"),
      },
    ],
    [isMedium, t],
  );
  const tableData = useMemo(
    () =>
      data
        ?.map((d) => ({
          ...d,
          totalAmount: d.monetary | d.nonMonetary,
        }))
        .reduce((acc: TableData[], curr) => {
          const item = acc.find((a) => a.name === curr.name);
          if (item) {
            if (!item.items) {
              const items = [{ ...item }];
              item.items = items;
            }
            item.date = undefined;
            item.totalAmount = item.totalAmount + curr.totalAmount;
            item.monetary = item.monetary + curr.monetary;
            item.nonMonetary = item.nonMonetary + curr.nonMonetary;
            item.items.push(curr);
          } else {
            acc.push(curr);
          }
          return acc;
        }, [])
        .sort((a, b) => b.totalAmount - a.totalAmount) || [],
    [data],
  );
  return (
    <DataTable<TableData, unknown>
      title={t("donors")}
      pageSize={25}
      columns={columns}
      stickyColumn={true}
      data={tableData}
      getSubRows={(row) => row.items}
    />
  );
};
