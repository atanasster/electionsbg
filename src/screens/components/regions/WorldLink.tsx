import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { Link } from "@/ux/Link";
import { Tooltip } from "@/ux/Tooltip";
import { FC } from "react";
import { PartyVotesXS } from "../PartyVotesXS";
import { useTranslation } from "react-i18next";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { WorldSilhouette } from "./WorldSilhouette";

export const WorldLink: FC<{ size: MapCoordinates }> = ({ size }) => {
  const { topVotesParty } = usePartyInfo();
  const { votesWorld } = useRegionVotes();
  const worldVotes = votesWorld();
  const { t } = useTranslation();

  const topWorldParty = topVotesParty(worldVotes?.results.votes);
  const isXLarge = useMediaQueryMatch("xl");
  const isMedium = useMediaQueryMatch("md");
  const width: number = isXLarge ? 160 : isMedium ? 120 : 100;

  const height = 0.7 * width;
  return (
    <Link
      to={`/municipality/32`}
      aria-label={t("abroad")}
      style={{
        position: "absolute",
        left: size[0] - width,
        top: size[1] - height,
      }}
    >
      <Tooltip
        content={
          <div>
            <div className="text-lg text-center pb-1">{t("abroad")}</div>
            <PartyVotesXS votes={worldVotes?.results.votes} />
          </div>
        }
      >
        <WorldSilhouette
          fillColor={topWorldParty?.color}
          width={width}
          height={height}
          className="border-2 hover:border-muted-foreground rounded-xl p-1 bg-card"
        />
      </Tooltip>
    </Link>
  );
};
