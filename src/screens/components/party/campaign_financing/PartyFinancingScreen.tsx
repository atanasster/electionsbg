import { PartyInfo } from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { localDate } from "@/data/utils";

import { IconTabs } from "@/screens/IconTabs";
import { Caption } from "@/ux/Caption";
import { Banknote, UsersRound, Vote } from "lucide-react";
import { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PartyDonorsTable } from "./PartyDonorsTable";
import { PartyCandidatesTable } from "./PartyCandidatesTable";
import { PartyPartiesTable } from "./PartyPartiesTable";
import { FilingSummary } from "./FilingSummary";
import { ErrorSection } from "../../ErrorSection";
import { useFinancing } from "./useFinancing";

const dataViews = ["donors", "candidates", "parties"] as const;
type DataViewType = (typeof dataViews)[number];

const DataTypeIcons: Record<DataViewType, ReactNode> = {
  donors: <Banknote />,
  candidates: <UsersRound />,
  parties: <Vote />,
};

export const PartyFinancingScreen: FC<{ party?: PartyInfo }> = ({ party }) => {
  const { t } = useTranslation();
  const { financing, isError, priorFinancing } = useFinancing(party);
  const { selected } = useElectionContext();
  const shortTitle = party?.nickName;
  return financing ? (
    <>
      <FilingSummary
        filing={financing?.data.filing}
        priorFiling={priorFinancing?.data.filing}
        party={party}
      />
      <IconTabs<DataViewType>
        title={shortTitle}
        tabs={dataViews}
        icons={DataTypeIcons}
        storageKey="party_financing_tabs"
        className="w-28"
      >
        {(view) => {
          if (view === "donors" && financing) {
            return (
              <>
                <Caption className="py-8">{t("donors")}</Caption>
                <PartyDonorsTable data={financing.data.fromDonors} />
              </>
            );
          }
          if (view == "candidates" && financing) {
            return (
              <>
                <Caption className="py-8">{t("candidates")}</Caption>
                <PartyCandidatesTable data={financing.data.fromCandidates} />
              </>
            );
          }
          if (view == "parties" && financing) {
            return (
              <>
                <Caption className="py-8">{t("parties")}</Caption>
                <PartyPartiesTable data={financing.data.fromParties} />
              </>
            );
          }
        }}
      </IconTabs>
    </>
  ) : (
    isError && (
      <ErrorSection
        title={t("no_results")}
        description={`${t("no_financing_data")} ${localDate(selected)}`}
      />
    )
  );
};
