import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { FC } from "react";
import { ElectionRegion } from "@/data/dataTypes";
import { useTranslation } from "react-i18next";
import { AreaVotesTable } from "../AreaVotesTable";

export const RegionsAreasTable: FC = () => {
  const { t } = useTranslation();
  const { votes } = useRegionVotes();
  return (
    <AreaVotesTable<ElectionRegion>
      title={t("votes_by_region")}
      visibleColumns={["oblast"]}
      votes={votes}
      votesAreas={(data) => ({
        oblast: data.key,
      })}
    />
  );
};
