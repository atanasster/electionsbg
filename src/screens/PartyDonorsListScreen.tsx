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
import { PartyDonorsTable } from "./components/party/campaign_financing/PartyDonorsTable";
import { PartyLink } from "./components/party/PartyLink";
import { ErrorSection } from "./components/ErrorSection";

export const PartyDonorsListScreen: FC = () => {
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

  const title = nickName
    ? (fullNameFor(nickName, selected) ?? party?.name ?? nickName)
    : "";

  return (
    <div className="w-full max-w-7xl mx-auto px-4 pb-12">
      <Title
        className="w-auto flex justify-center md:py-10"
        title={title}
        description={`${t("donors")} — ${title}`}
      >
        <PartyLink
          className="w-auto px-4"
          party={party}
          width="w-16"
          link={false}
        />
      </Title>
      <Caption>{`${title} — ${t("donors")}`}</Caption>
      {financing && <PartyDonorsTable data={financing.data.fromDonors} />}
    </div>
  );
};
