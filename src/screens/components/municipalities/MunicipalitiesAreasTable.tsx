import { FC } from "react";
import { ElectionMunicipality } from "@/data/dataTypes";
import { useTranslation } from "react-i18next";
import { AreaVotesTable } from "../AreaVotesTable";
import { useMunicipalitiesByRegion } from "@/data/municipalities/useMunicipalitiesByRegion";

export const MunicipalitiesAreasTable: FC<{ region: string }> = ({
  region,
}) => {
  const { t } = useTranslation();
  const votes = useMunicipalitiesByRegion(region);
  return (
    <AreaVotesTable<ElectionMunicipality>
      title={t("votes_by_municipality")}
      votes={votes}
      visibleColumns={["obshtina"]}
      votesAreas={(data) => ({
        oblast: data.oblast,
        obshtina: data.obshtina,
      })}
    />
  );
};
