import { MapLayout } from "@/layout/MapLayout";

import { municipalities } from "./data/json_types";
import { MunicipalitiesMap } from "./components/MunicipalitiesMap";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ProtocolSummary } from "./components/ProtocolSummary";
import { useAggregatedVotes } from "@/data/useAggregatedVotes";
import { Title } from "@/ux/Title";
import { useRegions } from "@/data/useRegions";

export const MunicipalitiesScreen = () => {
  const [searchParams] = useSearchParams();
  const { findRegion } = useRegions();
  const { votesByRegion } = useAggregatedVotes();
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
      {regionVotes && regionVotes.results.protocol && (
        <ProtocolSummary
          protocol={regionVotes.results.protocol}
          votes={regionVotes.results.votes}
        />
      )}
      <MapLayout>
        {(size) => (
          <MunicipalitiesMap
            municipalities={municipalities}
            region={region}
            size={size}
          />
        )}
      </MapLayout>
    </>
  );
};
