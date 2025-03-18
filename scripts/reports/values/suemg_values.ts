import { pctChange } from "@/data/utils";
import { CalcProcProps } from "../report_types";

export const calcSuemgValues = ({
  votes,
  protocol: p,
  election,
}: CalcProcProps) => {
  if (!election.hasSuemg || !p) {
    return undefined;
  }

  const isChanged = !!votes.find(
    (v) => (v.machineVotes || 0) !== (v.suemgVotes || 0),
  );

  if (!isChanged) {
    return undefined;
  }

  const suemgVotes = votes.reduce((acc, v) => {
    return acc + (v.suemgVotes || 0);
  }, 0);
  const machineVotesChange = (p.numValidMachineVotes || 0) - suemgVotes;
  const pctSuemg = pctChange(p.numValidMachineVotes, suemgVotes);
  const pctMachineVotesChange = pctChange(p.numValidMachineVotes, suemgVotes);
  const suemgTotal = (p.numValidVotes || 0) + (suemgVotes || 0);
  const totalVotes = (p.numValidVotes || 0) + (p.numValidMachineVotes || 0);
  const pctVotesChange = pctChange(totalVotes, suemgTotal);
  return {
    value: machineVotesChange,
    suemgVotes,
    machineVotesChange,
    pctSuemg,
    suemgTotal,
    pctMachineVotesChange,
    machineVotes: p.numValidMachineVotes,
    paperVotes: p.numValidVotes,
    pctVotesChange,
    totalVotes,
  };
};
