import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { localDate } from "@/data/utils";
import { useElectionContext } from "@/data/ElectionContext";
import { PreferencesSofia } from "./components/preferences/PreferencesSofia";

export const SofiaPreferencesScreen: FC = () => {
  const { selected } = useElectionContext();
  const { t } = useTranslation();
  const title = `${t("sofia_city")} — ${t("preferences")} — ${localDate(selected)}`;
  return (
    <>
      <Title description={t("all_preferences_description")}>{title}</Title>
      <div className="w-full max-w-7xl mx-auto px-4 pb-12">
        <PreferencesSofia />
      </div>
    </>
  );
};
