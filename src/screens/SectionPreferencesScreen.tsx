import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useSectionsVotes } from "@/data/sections/useSectionsVotes";
import { localDate } from "@/data/utils";
import { useElectionContext } from "@/data/ElectionContext";
import { PreferencesBySection } from "./components/preferences/PreferencesBySection";

export const SectionPreferencesScreen: FC = () => {
  const { id: sectionCode } = useParams();
  const section = useSectionsVotes(sectionCode);
  const { selected } = useElectionContext();
  const { t } = useTranslation();
  if (!sectionCode) return null;
  const name = `${t("section")} ${sectionCode}`;
  const title = `${name} — ${t("preferences")} — ${localDate(selected)}`;
  return (
    <>
      <Title description={t("all_preferences_description")}>{title}</Title>
      <div className="w-full max-w-7xl mx-auto px-4 pb-12">
        <PreferencesBySection section={sectionCode} region={section?.oblast} />
      </div>
    </>
  );
};
