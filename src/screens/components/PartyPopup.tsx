import { PartyInfo, Votes } from "@/data/dataTypes";
import { Caption } from "@/ux/Caption";
import { Tooltip } from "@/ux/Tooltip";
import { FC } from "react";
import { PartyVotesXS } from "./PartyVotesXS";
import { PartyLabel } from "./PartyLabel";

export const PartyPopup: FC<{
  party: PartyInfo;
  votes: Votes[];
  caption?: string;
}> = ({ party, caption, votes }) => {
  return (
    <Tooltip
      content={
        <div>
          {caption && <Caption>{caption}</Caption>}
          <PartyVotesXS votes={votes} />
        </div>
      }
    >
      <div>
        <PartyLabel party={party} />
      </div>
    </Tooltip>
  );
};
