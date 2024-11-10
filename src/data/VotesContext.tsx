import { useEffect, useState } from "react";
import { ElectionVotes } from "./dataTypes";

export const useElectionVotes = () => {
  const [votes, setVotes] = useState<ElectionVotes[]>([]);

  useEffect(() => {
    fetch("/2024_10/votes.json")
      .then((response) => response.json())
      .then((data) => {
        setVotes(data);
      });
  }, []);
  const findSectionVotes = (section: string) => {
    return votes.find((vote) => vote.section === section);
  };

  return { findSectionVotes };
};
