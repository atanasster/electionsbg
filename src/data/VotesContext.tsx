import { useEffect, useState } from "react";

type ElectionVotes = {
  document: number;
  section: string;
  [key: number]: {
    totalVotes: number;
    paperVotes: number;
    machineVotes: number;
  };
};

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
