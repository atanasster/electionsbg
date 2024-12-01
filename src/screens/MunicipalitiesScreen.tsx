import { MapLayout } from "@/layout/MapLayout";

import { MunicipalitiesMap } from "./components/MunicipalitiesMap";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ProtocolSummary } from "./components/ProtocolSummary";
import { useRegionVotes } from "@/data/useRegionVotes";
import { Title } from "@/ux/Title";
import { useRegions } from "@/data/useRegions";
import { useMunicipalitiesMap } from "@/data/useMunicipalitiesMap";
import { TopParties } from "./components/TopParties";

export const MunicipalitiesScreen = () => {
  const [searchParams] = useSearchParams();
  const { findRegion } = useRegions();
  const { municipalities } = useMunicipalitiesMap();
  const { votesByRegion } = useRegionVotes();
  const { i18n } = useTranslation();
  const region = searchParams.get("region");
  if (!region) {
    return null;
  }
  const info = findRegion(region);
  const regionVotes = (info && votesByRegion(info.oblast)) || null;

  return (
    <>
      <Title>
        {(i18n.language === "bg" ? info?.name : info?.name_en) || ""}
      </Title>
      <ProtocolSummary
        protocol={regionVotes?.results.protocol}
        votes={regionVotes?.results.votes}
      />
      {municipalities && (
        <MapLayout>
          {(size) => (
            <MunicipalitiesMap
              municipalities={municipalities}
              region={region}
              size={size}
            />
          )}
        </MapLayout>
      )}
      <TopParties votes={regionVotes?.results.votes} />
    </>
  );
};
