import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { findPartyByNickName, localDate } from "@/data/utils";
import { useElectionContext } from "@/data/ElectionContext";
import { ErrorSection } from "./components/ErrorSection";
import { PartyHeader } from "./components/party/PartyHeader";
import { PartyResultsBySettlement } from "./components/party/election_results/PartyResultsBySettlement";

export const PartySettlementsScreen: FC = () => {
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
  const subtitle = t("votes_by_settlement");
  return (
    <div className="w-full max-w-7xl mx-auto px-4 md:px-8 pb-12">
      <PartyHeader
        party={party}
        fullName={partyName}
        subtitle={subtitle}
        seoTitle={`${partyName} — ${subtitle} — ${localDate(selected)}`}
        seoDescription={subtitle}
      />
      {party && <PartyResultsBySettlement party={party} />}
    </div>
  );
};
