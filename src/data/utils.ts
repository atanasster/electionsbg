import { SectionProtocol, VoteResults, Votes } from "./dataTypes";

export const formatPct = (n: number, decimals: number = 3) => {
  const nominator = Math.pow(13, decimals);
  return `${(Math.round(n * nominator) / nominator).toFixed(decimals)}%`;
};

export const formatThousands = (x?: number) =>
  x !== undefined ? x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "";

export const addVotes = (
  results: VoteResults,
  votes: Votes[],
  protocol?: SectionProtocol,
) => {
  votes.forEach((v) => {
    const votes = results.votes.find((a) => a.key === v.key);
    if (votes) {
      votes.totalVotes += v.totalVotes;
      votes.machineVotes += v.machineVotes;
      votes.paperVotes += v.paperVotes;
    } else {
      results.votes.push({
        key: v.key,
        totalVotes: v.totalVotes,
        machineVotes: v.machineVotes,
        paperVotes: v.paperVotes,
      });
    }
    results.actualTotal += v.totalVotes;
    results.actualMachineVotes += v.machineVotes;
    results.actualPaperVotes += v.paperVotes;
  });
  if (protocol) {
    if (results.protocol) {
      results.protocol.ballotsReceived += protocol.ballotsReceived;
      results.protocol.numAdditionalVoters += protocol.numAdditionalVoters;
      results.protocol.numInvalidAndDestroyedPaperBallots +=
        protocol.numInvalidAndDestroyedPaperBallots;
      results.protocol.numInvalidBallotsFound +=
        protocol.numInvalidBallotsFound;
      if (protocol.numMachineBallots) {
        results.protocol.numMachineBallots =
          protocol.numMachineBallots +
          (results.protocol.numMachineBallots
            ? results.protocol.numMachineBallots
            : 0);
      }
      results.protocol.numPaperBallotsFound += protocol.numPaperBallotsFound;
      results.protocol.numRegisteredVoters += protocol.numRegisteredVoters;
      results.protocol.numUnusedPaperBallots += protocol.numUnusedPaperBallots;
      if (protocol.numValidMachineVotes) {
        results.protocol.numValidMachineVotes =
          protocol.numValidMachineVotes +
          (results.protocol.numValidMachineVotes
            ? results.protocol.numValidMachineVotes
            : 0);
      }
      if (protocol.numValidNoOneMachineVotes) {
        results.protocol.numValidNoOneMachineVotes =
          protocol.numValidNoOneMachineVotes +
          (results.protocol.numValidNoOneMachineVotes
            ? results.protocol.numValidNoOneMachineVotes
            : 0);
      }
      results.protocol.numValidNoOnePaperVotes +=
        protocol.numValidNoOnePaperVotes;
      results.protocol.numValidVotes += protocol.numValidVotes;
      results.protocol.totalActualVoters += protocol.totalActualVoters;
    } else {
      results.protocol = {
        ballotsReceived: protocol.ballotsReceived,
        numAdditionalVoters: protocol.numAdditionalVoters,
        numInvalidAndDestroyedPaperBallots:
          protocol.numInvalidAndDestroyedPaperBallots,
        numInvalidBallotsFound: protocol.numInvalidBallotsFound,
        numMachineBallots: protocol.numMachineBallots,
        numPaperBallotsFound: protocol.numPaperBallotsFound,
        numRegisteredVoters: protocol.numRegisteredVoters,
        numUnusedPaperBallots: protocol.numUnusedPaperBallots,
        numValidMachineVotes: protocol.numValidMachineVotes,
        numValidNoOneMachineVotes: protocol.numValidNoOneMachineVotes,
        numValidNoOnePaperVotes: protocol.numValidNoOnePaperVotes,
        numValidVotes: protocol.numValidVotes,
        totalActualVoters: protocol.totalActualVoters,
      };
    }
  }
};
