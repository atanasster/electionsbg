import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { useSettlementVotes } from "@/data/settlements/useSettlementVotes";
import { localDate } from "@/data/utils";
import { useElectionContext } from "@/data/ElectionContext";
import { PreferencesBySettlement } from "./components/preferences/PreferencesBySettlement";

export const SettlementPreferencesScreen: FC = () => {
  const { id: ekatte } = useParams();
  const { findSettlement } = useSettlementsInfo();
  const { settlement } = useSettlementVotes(ekatte ?? "");
  const { selected } = useElectionContext();
  const { t, i18n } = useTranslation();
  if (!ekatte) return null;
  const info = findSettlement(ekatte);
  const name =
    (i18n.language === "bg"
      ? info?.long_name || info?.name
      : info?.long_name_en || info?.name_en) || ekatte;
  const title = `${name} — ${t("preferences")} — ${localDate(selected)}`;
  return (
    <>
      <Title description={t("all_preferences_description")}>{title}</Title>
      <div className="w-full max-w-7xl mx-auto px-4 pb-12">
        <PreferencesBySettlement ekatte={ekatte} region={settlement?.oblast} />
      </div>
    </>
  );
};
