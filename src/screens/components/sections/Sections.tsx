import { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useSettlementVotes } from "@/data/settlements/useSettlementVotes";
import { PartyVotesTable } from "../PartyVotesTable";
import { useSettlementStats } from "@/data/settlements/useSettlementStats";
import { SectionsList } from "./SectionsList";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useRegions } from "@/data/regions/useRegions";
import { Link } from "@/ux/Link";
import { H1 } from "@/ux/H1";
import { SEO } from "@/ux/SEO";
import { ProtocolSummary } from "../protocols/ProtocolSummary";
import {
  ChartLine,
  Heart,
  MemoryStick,
  RotateCcwSquare,
  UsersRound,
  Vote,
} from "lucide-react";
import { Caption } from "@/ux/Caption";
import { MultiHistoryChart } from "../charts/MultiHistoryChart";
import { IconTabs } from "../../IconTabs";
import { PreferencesBySettlement } from "../preferences/PreferencesBySettlement";
import { useElectionContext } from "@/data/ElectionContext";
import { PartyRecountTable } from "../PartyRecountTable";
import { PartySuemgTable } from "../PartySuemgTable";
import { RecountCards } from "../protocols/RecountCards";

const dataViews = [
  "sections",
  "parties",
  "recount",
  "suemg",
  "pref.",
  "chart",
] as const;
type DataViewType = (typeof dataViews)[number];

const DataTypeIcons: Record<DataViewType, ReactNode> = {
  sections: <Vote />,
  parties: <UsersRound />,
  recount: <RotateCcwSquare />,
  suemg: <MemoryStick />,
  "pref.": <Heart />,
  chart: <ChartLine />,
};
export const Sections: FC<{ ekatte: string }> = ({ ekatte }) => {
  const { settlement } = useSettlementVotes(ekatte);
  const { t, i18n } = useTranslation();
  const { electionStats } = useElectionContext();

  const { prevVotes, stats } = useSettlementStats(ekatte);
  const { findSettlement } = useSettlementsInfo();
  const { findMunicipality } = useMunicipalities();
  const { findRegion } = useRegions();
  const info = findSettlement(ekatte);
  const municipality = findMunicipality(info?.obshtina);
  const region = findRegion(info?.oblast);
  const excluded: { exclude: DataViewType[]; replace: DataViewType } = {
    exclude: [],
    replace: "sections",
  };
  if (!electionStats?.hasPreferences) {
    excluded.exclude.push("pref.");
  }
  if (!electionStats?.hasRecount) {
    excluded.exclude.push("recount");
  }
  if (!electionStats?.hasSuemg) {
    excluded.exclude.push("suemg");
  }
  const shortTitle =
    info && (i18n.language === "bg" ? info?.name : info?.name_en);

  const title = (
    <>
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
      {shortTitle}
    </>
  );
  const titleStr = `${
    region?.oblast
      ? `${
          i18n.language === "bg"
            ? region?.long_name || region?.name
            : region?.long_name_en || region?.name_en
        } / `
      : ""
  }${
    municipality?.obshtina
      ? `${
          i18n.language === "bg" ? municipality?.name : municipality?.name_en
        } / `
      : ""
  }${shortTitle}`;
  return (
    <>
      <SEO
        title={`${t("sections")} ${info ? (i18n.language === "bg" ? info?.name : info?.name_en) : ""}`}
        description="Bulgaria election results in a set of polling stations"
      />
      <H1>
        {t("sections")} {title}
      </H1>
      <ProtocolSummary
        results={settlement?.results}
        original={settlement?.original}
      />
      <RecountCards
        results={settlement?.results}
        original={settlement?.original}
      />
      <IconTabs<DataViewType>
        title={title}
        shortTitle={shortTitle}
        tabs={dataViews}
        icons={DataTypeIcons}
        excluded={excluded}
        storageKey="sections_view"
      >
        {(view) => {
          if (view === "sections" && settlement) {
            return (
              <>
                <Caption className="py-8">
                  {t("sections")} {title}
                </Caption>
                <SectionsList
                  sections={settlement.sections}
                  title={shortTitle || t("sections")}
                />
              </>
            );
          }
          if (view == "parties") {
            return (
              <PartyVotesTable
                title={titleStr}
                results={settlement?.results}
                stats={stats}
                prevElection={prevVotes}
              />
            );
          }
          if (view == "recount") {
            return <PartyRecountTable title={titleStr} votes={settlement} />;
          }
          if (view == "suemg") {
            return (
              <PartySuemgTable title={titleStr} results={settlement?.results} />
            );
          }
          if (view === "pref.") {
            return (
              <PreferencesBySettlement
                ekatte={settlement?.ekatte}
                region={settlement?.oblast}
              />
            );
          }
          if (view == "chart" && stats) {
            return <MultiHistoryChart stats={stats} />;
          }
        }}
      </IconTabs>
    </>
  );
};
