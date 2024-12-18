import { MapLayout } from "@/layout/MapLayout";
import { SettlementsMap } from "./components/SettlementsMap";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMunicipalityVotes } from "@/data/municipalities/useMunicipalityVotes";
import { ProtocolSummary } from "./components/ProtocolSummary";
import { useRegions } from "@/data/regions/useRegions";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useMunicipalityStats } from "@/data/municipalities/useMunicipalityStats";
import { PartyVotesTable } from "./components/PartyVotesTable";
import { SEO } from "@/ux/SEO";
import { H1 } from "@/ux/H1";
import { Link } from "@/ux/Link";

export const SettlementsScreen = () => {
  const { id: muniCode } = useParams();
  const { findRegion } = useRegions();
  const { municipality } = useMunicipalityVotes(muniCode);
  const { i18n, t } = useTranslation();
  const { findMunicipality } = useMunicipalities();
  const info = findMunicipality(muniCode);
  const { prevVotes, stats } = useMunicipalityStats(muniCode);
  if (!muniCode) {
    return null;
  }
  const region = findRegion(municipality?.oblast);
  if (!region || !municipality) {
    return null;
  }
  return (
    <>
      <SEO
        title={`${t("municipalities")} ${info ? (i18n.language === "bg" ? info?.name : info?.name_en) : ""}`}
        description="Interactive map  of a settlement in the elections in Bulgaria"
      />
      <H1>
        <Link to={`/municipality/${region.oblast}`}>
          {i18n.language === "bg"
            ? region.long_name || region.name
            : region.long_name_en || region.name_en}
        </Link>
        {" / "}
        {i18n.language === "bg" ? info?.name : info?.name_en}
      </H1>

      <ProtocolSummary
        protocol={municipality?.results.protocol}
        votes={municipality?.results.votes}
      />
      {info && (
        <MapLayout>
          {(size, withNames) => (
            <SettlementsMap
              municipality={info}
              size={size}
              withNames={withNames}
            />
          )}
        </MapLayout>
      )}
      <PartyVotesTable
        votes={municipality?.results.votes}
        stats={stats}
        prevElectionVotes={prevVotes?.results?.votes}
      />
    </>
  );
};
