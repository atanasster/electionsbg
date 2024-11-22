import { useTranslation } from "react-i18next";

import { MapLayout } from "@/layout/MapLayout";
import { regions } from "./data/json_types";
import { RegionsMap } from "./components/RegionsMap";
import { Title } from "@/ux/Title";
import { useRegionVotes } from "@/data/useRegionVotes";
import { ProtocolSummary } from "./components/ProtocolSummary";
import { useMemo } from "react";

export const RegionsScreen = () => {
  const { t } = useTranslation();
  const { countryVotes } = useRegionVotes();
  const results = useMemo(() => countryVotes(), [countryVotes]);
  return (
    <>
      <Title>{t("bulgaria")}</Title>
      {results && results.protocol && (
        <ProtocolSummary protocol={results.protocol} votes={results.votes} />
      )}
      <MapLayout>
        {(size) => <RegionsMap regions={regions} size={size} />}
      </MapLayout>
    </>
  );
};
