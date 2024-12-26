import { FinancingFromCandidates } from "@/data/dataTypes";
import { formatThousands } from "@/data/utils";
import { DataTable, DataTableColumns } from "@/ux/DataTable";
import { Hint } from "@/ux/Hint";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";

type TableData = FinancingFromCandidates & {
  totalAmount: number;
  items?: TableData[];
};
export const PartyCandidatesTable: FC<{ data: FinancingFromCandidates[] }> = ({
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
        accessorKey: "totalAmount",
        header: (
          <Hint text={t("pct_party_votes_explainer")}>
            <div>{t("total")}</div>
          </Hint>
        ) as never,
        className: "text-right",
        cell: ({ row }) => formatThousands(row.original.totalAmount, 0),
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
      pageSize={25}
      columns={columns}
      stickyColumn={true}
      data={tableData}
      getSubRows={(row) => row.items}
    />
  );
};
