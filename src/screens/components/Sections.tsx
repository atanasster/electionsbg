import { FC, ReactNode, useState } from "react";
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
import { TableProperties, Vote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { Caption } from "@/ux/Caption";

const dataViews = ["sections", "table"] as const;
type DataViewType = (typeof dataViews)[number];

const DataTypeIcons: Record<DataViewType, ReactNode> = {
  sections: <Vote />,
  table: <TableProperties />,
};
export const Sections: FC<{ ekatte: string }> = ({ ekatte }) => {
  const [view, setViewInternal] = useState<DataViewType>(
    (localStorage.getItem("sections_view") as DataViewType) || "sections",
  );
  const setView = (newView: DataViewType) => {
    setViewInternal(newView);
    localStorage.setItem("sections_view", newView);
  };
  const { settlement } = useSettlementVotes(ekatte);
  const { t, i18n } = useTranslation();
  const { prevVotes, stats } = useSettlementStats(ekatte);
  const { findSettlement } = useSettlementsInfo();
  const { findMunicipality } = useMunicipalities();
  const { findRegion } = useRegions();
  const isMedium = useMediaQueryMatch("md");
  const info = findSettlement(ekatte);
  const municipality = findMunicipality(info?.obshtina);
  const region = findRegion(info?.oblast);
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
        protocol={settlement?.results.protocol}
        votes={settlement?.results.votes}
      />
      <Separator className="my-2" />
      <div className="flex justify-between w-full items-center">
        <div className="truncate font-semibold">
          {isMedium ? title : shortTitle}
        </div>
        <div className="flex gap-2 ">
          {dataViews.map((key: DataViewType) => {
            return (
              <Button
                key={key}
                variant="outline"
                role="radio"
                data-state={view === key ? "checked" : "unchecked"}
                className="flex w-20 data-[state=checked]:bg-muted"
                onClick={() => {
                  setView(key);
                }}
              >
                {DataTypeIcons[key]}
                <span className="text-xs text-muted-foreground">{t(key)}</span>
              </Button>
            );
          })}
        </div>
      </div>
      {view === "sections" && settlement && (
        <>
          <Caption className="py-8">
            {t("sections")} {title}
          </Caption>
          <SectionsList sections={settlement.sections} />
        </>
      )}
      {view == "table" && (
        <PartyVotesTable
          votes={settlement?.results.votes}
          stats={stats}
          prevElectionVotes={prevVotes?.results?.votes}
        />
      )}
    </>
  );
};
