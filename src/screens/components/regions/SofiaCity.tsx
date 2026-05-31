import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { Link } from "@/ux/Link";
import { Tooltip } from "@/ux/Tooltip";
import { FC } from "react";
import { PartyVotesXS } from "../PartyVotesXS";
import { useTranslation } from "react-i18next";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { SofiaSkyline } from "./SofiaSkyline";

export const SofiaCity: FC<{ size: MapCoordinates }> = ({ size }) => {
  const { topVotesParty } = usePartyInfo();
  const { votesSofia } = useRegionVotes();
  const { results: sofiaVotes } = votesSofia() || {};
  const { t } = useTranslation();

  const topWorldParty = topVotesParty(sofiaVotes?.votes);
  const isXLarge = useMediaQueryMatch("xl");
  const isMedium = useMediaQueryMatch("md");
  const width: number = isXLarge ? 160 : isMedium ? 120 : 100;
  const height = 0.7 * width;
  return (
    <Link
      to={`/sofia`}
      aria-label={t("sofia_city")}
      style={{
        position: "absolute",
        left: 0,
        top: size[1] - height,
      }}
    >
      <Tooltip
        content={
          <div>
            <div className="text-lg text-center pb-1">{t("sofia_city")}</div>
            <PartyVotesXS votes={sofiaVotes?.votes} />
          </div>
        }
      >
        <SofiaSkyline
          fillColor={topWorldParty?.color}
          width={width}
          height={height}
          className="border-2 hover:border-muted-foreground rounded-xl p-1 bg-card"
        />
      </Tooltip>
    </Link>
  );
};
