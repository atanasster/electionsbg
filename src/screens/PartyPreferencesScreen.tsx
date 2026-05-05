import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { findPartyByNickName, localDate } from "@/data/utils";
import { useElectionContext } from "@/data/ElectionContext";
import { ErrorSection } from "./components/ErrorSection";
import { PartyCandidatesScreen } from "./components/party/candidates/PartyCandidatesScreen";

export const PartyPreferencesScreen: FC = () => {
  const { id: nickName } = useParams();
  const { parties } = usePartyInfo();
  const { selected } = useElectionContext();
  const { t } = useTranslation();
  const { fullNameFor, displayNameFor } = useCanonicalParties();
  if (!nickName) return null;
  const party = findPartyByNickName(parties, nickName);
  if (parties && !party) {
    return (
      <ErrorSection
        title={displayNameFor(nickName) ?? nickName}
        description={`${t("no_party_information")} ${localDate(selected)}`}
      />
    );
  }
  const partyName = fullNameFor(nickName, selected) ?? party?.name ?? nickName;
  return (
    <>
      <Title
        description={t("preferences")}
        title={`${partyName} — ${t("preferences")}`}
        className="text-base md:text-xl lg:text-2xl py-4 md:py-6"
      >
        <>
          {partyName}
          <br />
          {t("preferences")}
        </>
      </Title>
      <div className="w-full max-w-7xl mx-auto px-4 pb-12">
        {party && <PartyCandidatesScreen party={party} />}
      </div>
    </>
  );
};
