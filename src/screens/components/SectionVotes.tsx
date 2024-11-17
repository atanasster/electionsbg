import { FC } from "react";
import { PartyVotes } from "./PartyVotes";
import { SectionProtocol, Votes } from "@/data/dataTypes";

export const SectionVotes: FC<{
  protocol: SectionProtocol;
  votes?: Votes[];
}> = ({ votes, protocol }) => {
  if (!votes) {
    return null;
  }

  return <PartyVotes votes={votes} protocol={protocol} />;
};
