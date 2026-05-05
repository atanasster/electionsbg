import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { Caption } from "@/ux/Caption";
import { useElectionContext } from "@/data/ElectionContext";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { findPartyByNickName, localDate } from "@/data/utils";
import { useFinancing } from "./components/party/campaign_financing/useFinancing";
import { OutsideServices } from "./components/party/campaign_financing/OusideServices";
import { TaxesAndFees } from "./components/party/campaign_financing/TaxesAndFees";
import { MediaPackage } from "./components/party/campaign_financing/MediaPackage";
import { PartyCampaignCostCard } from "./dashboard/cards/PartyCampaignCostCard";
import { PartyTopExpenseCard } from "./dashboard/cards/PartyTopExpenseCard";
import { PartyExpenseBreakdownTile } from "./dashboard/PartyExpenseBreakdownTile";
import { PartyLink } from "./components/party/PartyLink";
import { ErrorSection } from "./components/ErrorSection";

export const PartyExpensesScreen: FC = () => {
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

  const title = nickName
    ? (fullNameFor(nickName, selected) ?? party?.name ?? nickName)
    : "";
  const priorElection = priorFinancing ? priorElections?.name : undefined;
  const filing = financing?.data.filing;
  const priorFiling = priorFinancing?.data.filing;

  return (
    <div className="w-full max-w-7xl mx-auto px-4 pb-12">
      <Title
        className="w-auto flex justify-center md:py-10"
        title={title}
        description={`${t("campaign_cost")} — ${title}`}
      >
        <PartyLink
          className="w-auto px-4"
          party={party}
          width="w-16"
          link={false}
        />
      </Title>
      <Caption>{`${title} — ${t("campaign_cost")}`}</Caption>
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 my-4">
        <PartyCampaignCostCard
          filing={filing}
          priorFiling={priorFiling}
          priorElection={priorElection}
        />
        <PartyTopExpenseCard filing={filing} />
      </div>
      <div className="grid gap-3 grid-cols-1 my-4">
        <PartyExpenseBreakdownTile
          filing={filing}
          priorFiling={priorFiling}
          color={party?.color}
        />
      </div>
      {filing && (
        <>
          <div className="my-8">
            <Caption className="py-4">{t("outside_services")}</Caption>
            <OutsideServices
              services={filing.expenses.external}
              priorServices={priorFiling?.expenses.external}
            />
          </div>
          <div className="my-8">
            <Caption className="py-4">{t("taxes_and_fees")}</Caption>
            <TaxesAndFees
              taxes={filing.expenses.taxes}
              priorTaxes={priorFiling?.expenses.taxes}
            />
          </div>
          <div className="my-8">
            <Caption className="py-4">{t("media_package")}</Caption>
            <MediaPackage
              media={filing.expenses.mediaPackage}
              priorMedia={priorFiling?.expenses.mediaPackage}
            />
          </div>
        </>
      )}
    </div>
  );
};
