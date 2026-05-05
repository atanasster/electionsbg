import { useElectionContext } from "@/data/ElectionContext";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { localDate, matchPartyNickName } from "@/data/utils";
import { Caption } from "@/ux/Caption";
import { Title } from "@/ux/Title";
import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ErrorSection } from "../ErrorSection";
import { PartyLink } from "./PartyLink";
import { PartyDashboardCards } from "@/screens/dashboard/PartyDashboardCards";

export const Party: FC<{ nickName: string }> = ({ nickName }) => {
  const { parties } = usePartyInfo();
  const { t } = useTranslation();
  const { selected } = useElectionContext();
  const { displayNameFor, fullNameFor } = useCanonicalParties();
  const party = parties?.find((p) => matchPartyNickName({ nickName }, p, true));
  const heading = displayNameFor(nickName) ?? nickName;
  const title = fullNameFor(nickName, selected) ?? party?.name ?? nickName;
  return (
    <div className="w-full">
      {parties && !party ? (
        <ErrorSection
          title={heading}
          description={`${t("no_party_information")} ${localDate(selected)}`}
        />
      ) : (
        <>
          <Title
            className="w-auto flex justify-center md:py-10"
            title={heading}
            description={`Results for party ${title}`}
          >
            <PartyLink
              className="w-auto px-4"
              party={party}
              width="w-16"
              link={false}
            />
          </Title>
          <Caption>{title}</Caption>
          {party && <PartyDashboardCards party={party} />}
        </>
      )}
    </div>
  );
};
