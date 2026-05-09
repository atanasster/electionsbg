import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Caption } from "@/ux/Caption";
import { useElectionContext } from "@/data/ElectionContext";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { findPartyByNickName, localDate } from "@/data/utils";
import { useFinancing } from "./components/party/campaign_financing/useFinancing";
import { PartyDonorsTable } from "./components/party/campaign_financing/PartyDonorsTable";
import { PartyCandidatesTable } from "./components/party/campaign_financing/PartyCandidatesTable";
import { PartyPartiesTable } from "./components/party/campaign_financing/PartyPartiesTable";
import { PartyRaisedFundsCard } from "./dashboard/cards/PartyRaisedFundsCard";
import { PartyDonorsCountCard } from "./dashboard/cards/PartyDonorsCountCard";
import { PartyHeader } from "./components/party/PartyHeader";
import { ErrorSection } from "./components/ErrorSection";

export const PartyIncomeScreen: FC = () => {
  const { id: nickName } = useParams();
  const { t } = useTranslation();
  const { selected, electionStats, priorElections } = useElectionContext();
  const { parties } = usePartyInfo();
  const { fullNameFor, displayNameFor } = useCanonicalParties();
  const party = nickName ? findPartyByNickName(parties, nickName) : undefined;
  const { financing, priorFinancing } = useFinancing(party);
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
  const subtitle = t("raised_funds");
  const priorElection = priorFinancing ? priorElections?.name : undefined;

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
        <PartyRaisedFundsCard
          filing={financing?.data.filing}
          priorFiling={priorFinancing?.data.filing}
          priorElection={priorElection}
        />
        <PartyDonorsCountCard financing={financing} />
      </div>
      {financing && financing.data.fromDonors.length > 0 && (
        <div className="my-8">
          <Caption className="py-4">{t("donors")}</Caption>
          <PartyDonorsTable data={financing.data.fromDonors} />
        </div>
      )}
      {financing && financing.data.fromCandidates.length > 0 && (
        <div className="my-8">
          <Caption className="py-4">{t("candidates")}</Caption>
          <PartyCandidatesTable data={financing.data.fromCandidates} />
        </div>
      )}
      {financing && financing.data.fromParties.length > 0 && (
        <div className="my-8">
          <Caption className="py-4">{t("parties")}</Caption>
          <PartyPartiesTable data={financing.data.fromParties} />
        </div>
      )}
    </div>
  );
};
