import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useElectionContext } from "@/data/ElectionContext";
import { localDate } from "@/data/utils";
import { PreferencesAllRegions } from "./components/preferences/PreferencesAllRegions";

export const AllPreferencesScreen: FC = () => {
  const { t } = useTranslation();
  const { selected } = useElectionContext();
  const title = `${t("preferences")} — ${localDate(selected)}`;
  return (
    <>
      <Title description={t("all_preferences_description")}>{title}</Title>
      <div className="w-full max-w-7xl mx-auto px-4 pb-12">
        <PreferencesAllRegions />
      </div>
    </>
  );
};
