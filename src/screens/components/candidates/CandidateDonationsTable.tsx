import { FinancingFromCandidates } from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { DataTable, DataTableColumns } from "@/ux/data_table/DataTable";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";

type CandidateDonations = Omit<FinancingFromCandidates, "name">;

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined, string | null | undefined]
>): Promise<CandidateDonations[] | undefined> => {
  if (!queryKey[1]) {
    return undefined;
  }
  const response = await fetch(
    `/${queryKey[1]}/candidates/${queryKey[2]}/donations.json`,
  );
  const data = await response.json();
  return data;
};

type TableData = CandidateDonations & {
  totalAmount: number;
};
export const CandidateDonationsTable: FC<{ name: string }> = ({ name }) => {
  const { selected } = useElectionContext();
  const { data } = useQuery({
    queryKey: ["candidates_donations", selected, name],
    queryFn: queryFn,
  });

  const { t } = useTranslation();
  const columns: DataTableColumns<TableData, unknown> = useMemo(
    () => [
      {
        accessorKey: "date",
        header: t("date"),
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
        className: "font-bold",
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
          totalAmount: d.monetary | d.nonMonetary,
        }))
        .sort((a, b) => b.totalAmount - a.totalAmount) || [],
    [data],
  );
  return (
    <DataTable<TableData, unknown>
      title={t("donations")}
      pageSize={25}
      columns={columns}
      stickyColumn={true}
      data={tableData}
      initialSort={[{ desc: false, id: "date" }]}
    />
  );
};
