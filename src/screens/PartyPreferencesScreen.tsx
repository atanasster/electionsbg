import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { matchPartyNickName, localDate } from "@/data/utils";
import { useElectionContext } from "@/data/ElectionContext";
import { ErrorSection } from "./components/ErrorSection";
import { PartyCandidatesScreen } from "./components/party/candidates/PartyCandidatesScreen";

export const PartyPreferencesScreen: FC = () => {
  const { id: nickName } = useParams();
  const { parties } = usePartyInfo();
  const { selected } = useElectionContext();
  const { t } = useTranslation();
  if (!nickName) return null;
  const party = parties?.find((p) => matchPartyNickName({ nickName }, p, true));
  if (parties && !party) {
    return (
      <ErrorSection
        title={nickName}
        description={`${t("no_party_information")} ${localDate(selected)}`}
      />
    );
  }
  const title = `${party?.name || nickName} — ${t("preferences")} — ${localDate(selected)}`;
  return (
    <>
      <Title description={t("preferences")}>{title}</Title>
      <div className="w-full max-w-7xl mx-auto px-4 pb-12">
        {party && <PartyCandidatesScreen party={party} />}
      </div>
    </>
  );
};
