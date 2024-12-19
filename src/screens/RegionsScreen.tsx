import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { ProtocolSummary } from "./components/ProtocolSummary";
import { RegionData } from "./components/regions/RegionData";

export const RegionsScreen = () => {
  const { t } = useTranslation();
  const { countryVotes } = useRegionVotes();
  const results = countryVotes();
  const title = t("general_results");
  return (
    <>
      <Title description="Interactive country map  of the elections in Bulgaria">
        {title}
      </Title>
      <ProtocolSummary protocol={results.protocol} votes={results.votes} />

      <RegionData title={title} />
    </>
  );
};
