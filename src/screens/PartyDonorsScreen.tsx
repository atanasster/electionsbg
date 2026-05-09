import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useElectionContext } from "@/data/ElectionContext";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { findPartyByNickName, localDate } from "@/data/utils";
import { useFinancing } from "./components/party/campaign_financing/useFinancing";
import { PartyTopDonorsTile } from "./dashboard/PartyTopDonorsTile";
import { PartyDonorsCountCard } from "./dashboard/cards/PartyDonorsCountCard";
import { PartyHeader } from "./components/party/PartyHeader";
import { ErrorSection } from "./components/ErrorSection";

export const PartyDonorsScreen: FC = () => {
  const { id: nickName } = useParams();
  const { t } = useTranslation();
  const { selected, electionStats } = useElectionContext();
  const { parties } = usePartyInfo();
  const { fullNameFor, displayNameFor } = useCanonicalParties();
  const party = nickName ? findPartyByNickName(parties, nickName) : undefined;
  const { financing } = useFinancing(party);
  const heading = nickName ? (displayNameFor(nickName) ?? nickName) : "";

  if (!electionStats?.hasFinancials) {
    return (
      <ErrorSection
        title={heading}
        description={`${t("no_financing_data")} ${localDate(selected)}`}
      />
    );
  }

  if (parties && !party) {
    return (
      <ErrorSection
        title={heading}
        description={`${t("no_party_information")} ${localDate(selected)}`}
      />
    );
  }

  const partyName = nickName
    ? (fullNameFor(nickName, selected) ?? party?.name ?? nickName)
    : "";
  const subtitle = t("donors");

  return (
    <div className="w-full max-w-7xl mx-auto px-4 md:px-8 pb-12">
      <PartyHeader
        party={party}
        fullName={partyName}
        subtitle={subtitle}
        seoTitle={`${partyName} — ${subtitle}`}
        seoDescription={`${subtitle} — ${partyName}`}
      />
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 my-4">
        <PartyDonorsCountCard financing={financing} />
      </div>
      <div className="grid gap-3 grid-cols-1 my-4">
        <PartyTopDonorsTile
          financing={financing}
          partyNickName={party?.nickName}
          color={party?.color}
        />
      </div>
    </div>
  );
};
