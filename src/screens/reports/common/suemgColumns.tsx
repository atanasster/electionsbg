import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ReportColumns } from "./ReportTemplate";

export const useSuemgColumns = (changeColumns: boolean = true) => {
  const { t } = useTranslation();

  const columns: ReportColumns = useMemo(
    () => [
      {
        accessorKey: "machineVotes",
        hidden: changeColumns,
        header: t("machine_ballots"),
        dataType: "thousands",
      },
      {
        header: t("machine_ballots"),
        colSpan: 2,
        hidden: !changeColumns,
        columns: [
          {
            accessorKey: "machineVotes",
            header: t("recounted_votes"),
            dataType: "thousands",
          },
          {
            accessorKey: "suemgVotes",
            header: t("suemg"),
            dataType: "thousands",
          },
          {
            accessorKey: "machineVotesChange",
            header: t("change"),
            dataType: "thousandsChange",
          },
          {
            accessorKey: "pctSuemg",
            header: "%",
            dataType: "pctChange",
          },
        ],
      },
    ],
    [changeColumns, t],
  );
  return columns;
};
