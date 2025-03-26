import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ProtocolSummary } from "./components/protocols/ProtocolSummary";
import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { Title } from "@/ux/Title";
import { useRegions } from "@/data/regions/useRegions";
import { MunicipalityData } from "./components/municipalities/MunicipalityData";
import { RecountCards } from "./components/protocols/RecountCards";

export const MunicipalitiesScreen = () => {
  const { id: region } = useParams();
  const { findRegion } = useRegions();
  const { votesByRegion } = useRegionVotes();
  const { i18n } = useTranslation();
  if (!region) {
    return null;
  }
  const info = findRegion(region);
  const regionVotes = (info && votesByRegion(info.oblast)) || null;
  const title =
    (i18n.language === "bg"
      ? info?.long_name || info?.name
      : info?.long_name_en || info?.name_en) || "";
  return (
    <>
      <Title description="Interactive map of a municipality in the elections in Bulgaria">
        {title}
      </Title>
      <ProtocolSummary
        results={regionVotes?.results}
        original={regionVotes?.original}
      />
      <RecountCards
        results={regionVotes?.results}
        original={regionVotes?.original}
      />
      <MunicipalityData title={title} region={region} />
    </>
  );
};
