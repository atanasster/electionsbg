import { FC } from "react";
import { ElectionSettlement } from "@/data/dataTypes";
import { useTranslation } from "react-i18next";
import { AreaVotesTable } from "../AreaVotesTable";
import { useSettlementsByMunicipality } from "@/data/settlements/useSettlementsByMunicipality";

export const SettlementsAreasTable: FC<{ municipality: string }> = ({
  municipality,
}) => {
  const { t } = useTranslation();
  const votes = useSettlementsByMunicipality(municipality);
  return (
    <AreaVotesTable<ElectionSettlement>
      title={t("votes_by_settlement")}
      votes={votes}
      visibleColumns={["ekatte"]}
      votesAreas={(data) => ({
        oblast: data.oblast,
        obshtina: data.obshtina,
        ekatte: data.ekatte,
      })}
    />
  );
};
