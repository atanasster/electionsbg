import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { ProtocolSummary } from "./components/protocols/ProtocolSummary";
import { RegionData } from "./components/regions/RegionData";
import { useElectionContext } from "@/data/ElectionContext";
import { localDate } from "@/data/utils";
import { RecountCards } from "./components/protocols/RecountCards";

export const RegionsScreen = () => {
  const { t } = useTranslation();
  const { selected } = useElectionContext();
  const { countryVotes } = useRegionVotes();
  const { results, original } = countryVotes();
  const title = `${t("general_elections")} ${localDate(selected)}`;
  return (
    <>
      <Title description="Interactive country map of the elections in Bulgaria">
        {title}
      </Title>
      <ProtocolSummary results={results} original={original} />
      <RecountCards results={results} original={original} />
      <RegionData title={title} />
    </>
  );
};
