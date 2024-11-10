import { FC } from "react";

import { useElectionVotes } from "@/data/VotesContext";
import { PartyVotes } from "./PartyVotes";

export const SectionVotes: FC<{ section: string }> = ({ section }) => {
  const { findSectionVotes } = useElectionVotes();
  const votes = findSectionVotes(section);
  if (!votes) {
    return null;
  }
  return <PartyVotes votes={votes.votes} />;
};
