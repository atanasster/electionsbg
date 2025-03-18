import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ReportColumns } from "./ReportTemplate";

export const useSuemgColumns = () => {
  const { t } = useTranslation();
  const isSmall = useMediaQueryMatch("sm");

  const columns: ReportColumns = useMemo(
    () => [
      {
        header: t("machine_votes"),
        colSpan: 2,
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
            hidden: isSmall,
            dataType: "pctChange",
          },
        ],
      },
      {
        header: t("total_votes"),
        colSpan: 2,
        columns: [
          {
            accessorKey: "totalVotes",
            header: t("recounted_votes"),
            dataType: "thousands",
          },
          {
            accessorKey: "suemgTotal",
            header: t("suemg"),
            hidden: isSmall,
            dataType: "thousands",
          },
          {
            accessorKey: "pctVotesChange",
            header: "%",
            dataType: "pctChange",
          },
        ],
      },
    ],
    [isSmall, t],
  );
  return columns;
};
