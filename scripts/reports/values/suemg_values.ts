import { pctChange } from "@/data/utils";
import { CalcProcProps, DataTypes } from "../report_types";

export const calcSuemgValues = <DType extends DataTypes>({
  votes: allVotes,
  protocol: p,
  election,
  parties,
}: CalcProcProps<DType>) => {
  if (!election.hasSuemg || !p) {
    return undefined;
  }
  const votes = allVotes.filter((v) =>
    parties.find((p) => p.number === v.partyNum),
  );

  const diffVote = votes.find(
    (v) =>
      parties.find((p) => p.number === v.partyNum) &&
      (v.machineVotes || 0) !== (v.suemgVotes || 0),
  );
  const isChanged = !!diffVote;
  if (!isChanged) {
    return undefined;
  }

  const suemgVotes = votes.reduce((acc, v) => {
    return acc + (v.suemgVotes || 0);
  }, 0);
  const machineVotes = votes.reduce((acc, v) => {
    return acc + (v.machineVotes || 0);
  }, 0);
  const paperVotes = votes.reduce((acc, v) => {
    return acc + (v.paperVotes || 0);
  }, 0);
  const machineVotesChange = machineVotes - suemgVotes;
  const pctSuemg = pctChange(machineVotes, suemgVotes);
  const pctMachineVotesChange = pctChange(machineVotes, suemgVotes);
  const suemgTotal = paperVotes + suemgVotes;
  const totalVotes = paperVotes + machineVotes;
  const pctVotesChange = pctChange(totalVotes, suemgTotal);
  const topPartyChange = votes.reduce(
    (acc: { change: number; partyNum: number } | undefined, vote) => {
      const change = (vote.machineVotes || 0) - (vote.suemgVotes || 0);
      if (change > (acc?.change || 0)) {
        return {
          partyNum: vote.partyNum,
          change,
        };
      }
      return acc;
    },
    undefined,
  );

  const bottomPartyChange = votes.reduce(
    (acc: { change: number; partyNum: number } | undefined, vote) => {
      const change = (vote.machineVotes || 0) - (vote.suemgVotes || 0);
      if (change < (acc?.change || 0)) {
        return {
          partyNum: vote.partyNum,
          change,
        };
      }
      return acc;
    },
    undefined,
  );
  return {
    value: machineVotesChange,
    suemgVotes,
    machineVotesChange,
    pctSuemg,
    suemgTotal,
    pctMachineVotesChange,
    machineVotes,
    paperVotes,
    pctVotesChange,
    topPartyChange,
    bottomPartyChange,
    totalVotes,
  };
};
