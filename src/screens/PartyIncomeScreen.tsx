import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { Caption } from "@/ux/Caption";
import { useElectionContext } from "@/data/ElectionContext";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { localDate, matchPartyNickName } from "@/data/utils";
import { useFinancing } from "./components/party/campaign_financing/useFinancing";
import { PartyDonorsTable } from "./components/party/campaign_financing/PartyDonorsTable";
import { PartyCandidatesTable } from "./components/party/campaign_financing/PartyCandidatesTable";
import { PartyPartiesTable } from "./components/party/campaign_financing/PartyPartiesTable";
import { PartyRaisedFundsCard } from "./dashboard/cards/PartyRaisedFundsCard";
import { PartyDonorsCountCard } from "./dashboard/cards/PartyDonorsCountCard";
import { PartyLink } from "./components/party/PartyLink";
import { ErrorSection } from "./components/ErrorSection";

export const PartyIncomeScreen: FC = () => {
  const { id: nickName } = useParams();
  const { t } = useTranslation();
  const { selected, electionStats, priorElections } = useElectionContext();
  const { parties } = usePartyInfo();
  const { fullNameFor, displayNameFor } = useCanonicalParties();
  const party = parties?.find((p) => matchPartyNickName({ nickName }, p, true));
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

  const title = nickName
    ? (fullNameFor(nickName, selected) ?? party?.name ?? nickName)
    : "";
  const priorElection = priorFinancing ? priorElections?.name : undefined;

  return (
    <div className="w-full max-w-7xl mx-auto px-4 pb-12">
      <Title
        className="w-auto flex justify-center md:py-10"
        title={title}
        description={`${t("raised_funds")} — ${title}`}
      >
        <PartyLink
          className="w-auto px-4"
          party={party}
          width="w-16"
          link={false}
        />
      </Title>
      <Caption>{`${title} — ${t("raised_funds")}`}</Caption>
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
