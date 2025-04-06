import { PartyInfo } from "@/data/dataTypes";
import { FC } from "react";
import { PreferencesTable } from "../../preferences/PreferencesTable";
import { useCountryPreferences } from "./data/useCountryPreferences";
import { useTranslation } from "react-i18next";

export const PartyCandidatesAllRegions: FC<{ party: PartyInfo }> = ({
  party,
}) => {
  const preferences = useCountryPreferences(party);
  const { t } = useTranslation();
  return preferences ? (
    <PreferencesTable
      preferences={preferences}
      title={t("preferences_by_regions")}
      visibleColumns={["oblast", "candidate"]}
      hiddenColumns={["party"]}
    />
  ) : null;
};
