import { useElectionContext } from "@/data/ElectionContext";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { findPartyByNickName, localDate } from "@/data/utils";
import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ErrorSection } from "../ErrorSection";
import { PartyHeader } from "./PartyHeader";
import { PartyDashboardCards } from "@/screens/dashboard/PartyDashboardCards";

export const Party: FC<{ nickName: string }> = ({ nickName }) => {
  const { parties } = usePartyInfo();
  const { t } = useTranslation();
  const { selected } = useElectionContext();
  const { displayNameFor, fullNameFor } = useCanonicalParties();
  const party = findPartyByNickName(parties, nickName);
  const heading = displayNameFor(nickName) ?? nickName;
  const fullName = fullNameFor(nickName, selected) ?? party?.name ?? nickName;
  return (
    <div className="w-full">
      {parties && !party ? (
        <ErrorSection
          title={heading}
          description={`${t("no_party_information")} ${localDate(selected)}`}
        />
      ) : (
        <>
          <PartyHeader
            party={party}
            fullName={fullName}
            seoTitle={heading}
            seoDescription={`Results for party ${fullName}`}
          />
          {party && <PartyDashboardCards party={party} />}
        </>
      )}
    </div>
  );
};
