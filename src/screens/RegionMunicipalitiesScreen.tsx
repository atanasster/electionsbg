import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useRegions } from "@/data/regions/useRegions";
import { localDate } from "@/data/utils";
import { useElectionContext } from "@/data/ElectionContext";
import { isSofiaMir } from "@/data/dataTypes";
import { MunicipalitiesAreasTable } from "./components/municipalities/MunicipalitiesAreasTable";

export const RegionMunicipalitiesScreen: FC = () => {
  const { id: region } = useParams();
  const { findRegion } = useRegions();
  const { selected } = useElectionContext();
  const { t, i18n } = useTranslation();
  if (!region) return null;
  const info = findRegion(region);
  const isRayon = isSofiaMir(region);
  const name =
    (i18n.language === "bg"
      ? info?.long_name || info?.name
      : info?.long_name_en || info?.name_en) || "";
  const title = `${name} — ${t(isRayon ? "votes_by_rayon" : "votes_by_municipality")} — ${localDate(selected)}`;
  return (
    <>
      <Title
        description={t(
          isRayon ? "all_rayoni_description" : "all_municipalities_description",
        )}
      >
        {title}
      </Title>
      <div className="w-full max-w-7xl mx-auto px-4 pb-12">
        <MunicipalitiesAreasTable region={region} />
      </div>
    </>
  );
};
