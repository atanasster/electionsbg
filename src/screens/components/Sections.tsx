import { useSectionsInfo } from "@/data/useSectionsInfo";
import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSettlementVotes } from "@/data/useSettlementVotes";
import { PartyVotesTable } from "./PartyVotesTable";
import { useSettlementStats } from "@/data/useSettlementStats";
import { SectionsList } from "./SectionsList";
import { useSettlementsInfo } from "@/data/useSettlements";
import { useMunicipalities } from "@/data/useMunicipalities";
import { useRegions } from "@/data/useRegions";
import { Caption } from "@/ux/Caption";
import { Link } from "@/ux/Link";
import { H1 } from "@/ux/H1";
import { SEO } from "@/ux/SEO";
import { VoteResults } from "@/data/dataTypes";
import { addResults } from "@/data/utils";
import { ProtocolSummary } from "./ProtocolSummary";

export const Sections: FC<{ ekatte?: string }> = ({ ekatte }) => {
  const { findSections } = useSectionsInfo();
  const { votesBySettlement } = useSettlementVotes();
  const { t, i18n } = useTranslation();
  const { prevVotes, stats } = useSettlementStats(ekatte);
  const { findSettlement } = useSettlementsInfo();
  const { findMunicipality } = useMunicipalities();
  const { findRegion } = useRegions();
  const info = findSettlement(ekatte);
  const municipality = findMunicipality(info?.obshtina);
  const region = findRegion(info?.oblast);
  const sections = findSections(ekatte);
  const summaryResults = useMemo(() => {
    const results: VoteResults = {
      votes: [],
    };
    sections?.forEach((s) => {
      addResults(results, s.results.votes, s.results.protocol);
    });
    return results;
  }, [sections]);
  const settlementVotes = votesBySettlement(ekatte);

  return (
    <>
      <SEO
        title={`${t("sections")} ${info ? (i18n.language === "bg" ? info?.name : info?.name_en) : ""}`}
        description="Bulgaria election results in a set of polling stations"
      />
      <H1>
        {t("sections")}{" "}
        {region?.oblast && (
          <>
            <Link
              to={{
                pathname: "/municipality",
                search: {
                  region: region?.oblast,
                },
              }}
            >
              {i18n.language === "bg"
                ? region?.long_name || region?.name
                : region?.long_name_en || region?.name_en}
            </Link>
            {" / "}
          </>
        )}
        {municipality?.obshtina && (
          <>
            <Link
              to={{
                pathname: "/settlement",
                search: {
                  municipality: municipality?.obshtina,
                },
              }}
            >
              {i18n.language === "bg"
                ? municipality?.name
                : municipality?.name_en}
            </Link>
            {" / "}
          </>
        )}
        {info && (i18n.language === "bg" ? info?.name : info?.name_en)}
      </H1>
      <Caption className="py-8">
        {" "}
        {`${t("total_sections")}: ${sections?.length || 0}`}
      </Caption>
      <ProtocolSummary
        protocol={summaryResults.protocol}
        votes={summaryResults.votes}
      />
      {sections && <SectionsList sections={sections} />}
      <PartyVotesTable
        votes={settlementVotes?.results.votes}
        stats={stats}
        prevElectionVotes={prevVotes?.results?.votes}
      />
    </>
  );
};
