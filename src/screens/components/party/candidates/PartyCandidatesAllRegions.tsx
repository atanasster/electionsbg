import { PartyInfo } from "@/data/dataTypes";
import { FC } from "react";
import { PreferencesTable } from "../../preferences/PreferencesTable";
import { useCountryPreferences } from "./data/useCountryPreferences";

export const PartyCandidatesAllRegions: FC<{ party: PartyInfo }> = ({
  party,
}) => {
  const preferences = useCountryPreferences(party);
  return preferences ? (
    <PreferencesTable
      preferences={preferences}
      visibleColumns={["oblast", "candidate"]}
      hiddenColumns={["party"]}
      hideCaption
    />
  ) : null;
};
