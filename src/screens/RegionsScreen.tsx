import { useTranslation } from "react-i18next";

import { MapLayout } from "@/layout/MapLayout";
import { useRegionsMap } from "@/data/useRegionsMap";
import { RegionsMap } from "./components/RegionsMap";
import { Title } from "@/ux/Title";
import { useRegionVotes } from "@/data/useRegionVotes";
import { ProtocolSummary } from "./components/ProtocolSummary";
import { useMemo } from "react";
import { TopParties } from "./components/TopParties";
import { usePrevElectionRegionVotes } from "@/data/usePrevElectionRegionVotes";

export const RegionsScreen = () => {
  const { t } = useTranslation();
  const { regions } = useRegionsMap();
  const { countryVotes } = useRegionVotes();
  const { prevCountryVotes } = usePrevElectionRegionVotes();

  const results = useMemo(() => countryVotes(), [countryVotes]);
  const prevResults = useMemo(() => prevCountryVotes(), [prevCountryVotes]);
  return (
    <>
      <Title description="Interactive country map  of the elections in Bulgaria">
        {t("bulgaria")}
      </Title>
      <ProtocolSummary protocol={results.protocol} votes={results.votes} />
      {regions && (
        <MapLayout>
          {(size) => <RegionsMap regions={regions} size={size} />}
        </MapLayout>
      )}
      <TopParties votes={results.votes} prevElectionVotes={prevResults} />
    </>
  );
};
