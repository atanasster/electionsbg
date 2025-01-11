import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { FC } from "react";
import { ElectionRegion } from "@/data/dataTypes";
import { useTranslation } from "react-i18next";
import { AreaVotesTable } from "../AreaVotesTable";

export const SofiaAreasTable: FC = () => {
  const { t } = useTranslation();
  const { sofiaRegions } = useRegionVotes();
  const votes = sofiaRegions();
  return (
    <AreaVotesTable<ElectionRegion>
      title={t("votes_in_sofia")}
      visibleColumns={["oblast"]}
      votes={votes}
      votesAreas={(data) => ({
        oblast: data.key,
      })}
    />
  );
};
