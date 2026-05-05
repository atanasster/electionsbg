import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { matchPartyNickName, localDate } from "@/data/utils";
import { useElectionContext } from "@/data/ElectionContext";
import { ErrorSection } from "./components/ErrorSection";
import { PartyResultsByRegion } from "./components/party/election_results/PartyResultsByRegion";

export const PartyRegionsScreen: FC = () => {
  const { id: nickName } = useParams();
  const { parties } = usePartyInfo();
  const { selected } = useElectionContext();
  const { t } = useTranslation();
  const { fullNameFor, displayNameFor } = useCanonicalParties();
  if (!nickName) return null;
  const party = parties?.find((p) => matchPartyNickName({ nickName }, p, true));
  if (parties && !party) {
    return (
      <ErrorSection
        title={displayNameFor(nickName) ?? nickName}
        description={`${t("no_party_information")} ${localDate(selected)}`}
      />
    );
  }
  const partyName = fullNameFor(nickName, selected) ?? party?.name ?? nickName;
  const title = `${partyName} — ${t("votes_by_region")} — ${localDate(selected)}`;
  return (
    <>
      <Title description={t("votes_by_region")}>{title}</Title>
      <div className="w-full max-w-7xl mx-auto px-4 pb-12">
        {party && <PartyResultsByRegion party={party} />}
      </div>
    </>
  );
};
