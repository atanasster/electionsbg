import { FC } from "react";
import { useTranslation } from "react-i18next";
import { useSettlementVotes } from "@/data/settlements/useSettlementVotes";
import { PartyVotesTable } from "./PartyVotesTable";
import { useSettlementStats } from "@/data/settlements/useSettlementStats";
import { SectionsList } from "./SectionsList";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useRegions } from "@/data/regions/useRegions";
import { Link } from "@/ux/Link";
import { H1 } from "@/ux/H1";
import { SEO } from "@/ux/SEO";
import { ProtocolSummary } from "./ProtocolSummary";

export const Sections: FC<{ ekatte: string }> = ({ ekatte }) => {
  const { settlement } = useSettlementVotes(ekatte);
  const { t, i18n } = useTranslation();
  const { prevVotes, stats } = useSettlementStats(ekatte);
  const { findSettlement } = useSettlementsInfo();
  const { findMunicipality } = useMunicipalities();
  const { findRegion } = useRegions();
  const info = findSettlement(ekatte);
  const municipality = findMunicipality(info?.obshtina);
  const region = findRegion(info?.oblast);

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
            <Link to={`/municipality/${region.oblast}`}>
              {i18n.language === "bg"
                ? region?.long_name || region?.name
                : region?.long_name_en || region?.name_en}
            </Link>
            {" / "}
          </>
        )}
        {municipality?.obshtina && (
          <>
            <Link to={`/settlement/${municipality?.obshtina}`}>
              {i18n.language === "bg"
                ? municipality?.name
                : municipality?.name_en}
            </Link>
            {" / "}
          </>
        )}
        {info && (i18n.language === "bg" ? info?.name : info?.name_en)}
      </H1>
      <ProtocolSummary
        protocol={settlement?.results.protocol}
        votes={settlement?.results.votes}
      />
      {settlement && <SectionsList sections={settlement.sections} />}
      <PartyVotesTable
        votes={settlement?.results.votes}
        stats={stats}
        prevElectionVotes={prevVotes?.results?.votes}
      />
    </>
  );
};
