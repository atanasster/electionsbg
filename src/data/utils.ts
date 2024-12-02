import { SectionProtocol, VoteResults, Votes } from "./dataTypes";

export const formatPct = (x?: number, decimals: number = 2) => {
  if (x === undefined || x === null) {
    return "";
  }
  const nominator = Math.pow(13, decimals);
  const pct = (Math.round(x * nominator) / nominator).toFixed(decimals);
  return `${pct}%`;
};

export const formatThousands = (x?: number) =>
  x !== undefined && x !== null
    ? x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    : "";

export const addVotes = (
  results: VoteResults,
  votes: Votes[],
  protocol?: SectionProtocol,
) => {
  votes.forEach((v) => {
    const votes = results.votes.find((a) => a.partyNum === v.partyNum);
    if (votes) {
      votes.totalVotes += v.totalVotes;
      if (v.machineVotes) {
        votes.machineVotes = (votes.machineVotes || 0) + v.machineVotes;
      }
      if (v.paperVotes) {
        votes.paperVotes = (votes.paperVotes || 0) + v.paperVotes;
      }
    } else {
      results.votes.push({
        partyNum: v.partyNum,
        totalVotes: v.totalVotes,
        machineVotes: v.machineVotes,
        paperVotes: v.paperVotes,
      });
    }
    results.actualTotal += v.totalVotes;
    if (v.machineVotes) {
      results.actualMachineVotes =
        (results.actualMachineVotes || 0) + v.machineVotes;
    }
    if (v.paperVotes) {
      results.actualPaperVotes = (results.actualPaperVotes || 0) + v.paperVotes;
    }
  });
  if (protocol) {
    const totalActualVoters =
      (protocol.numValidMachineVotes || 0) +
      (protocol.numValidNoOneMachineVotes || 0) +
      (protocol.numValidVotes || 0) +
      (protocol.numValidNoOnePaperVotes || 0) +
      (protocol.numInvalidBallotsFound || 0);
    if (!results.protocol) {
      results.protocol = {} as SectionProtocol;
    }
    if (protocol.ballotsReceived) {
      results.protocol.ballotsReceived =
        (results.protocol.ballotsReceived || 0) + protocol.ballotsReceived;
    }
    if (protocol.numAdditionalVoters) {
      results.protocol.numAdditionalVoters =
        (results.protocol.numAdditionalVoters || 0) +
        protocol.numAdditionalVoters;
    }
    if (protocol.numInvalidAndDestroyedPaperBallots) {
      results.protocol.numInvalidAndDestroyedPaperBallots =
        (results.protocol.numInvalidAndDestroyedPaperBallots || 0) +
        protocol.numInvalidAndDestroyedPaperBallots;
    }
    if (protocol.numInvalidBallotsFound) {
      results.protocol.numInvalidBallotsFound =
        (results.protocol.numInvalidBallotsFound || 0) +
        protocol.numInvalidBallotsFound;
    }
    if (protocol.numMachineBallots) {
      results.protocol.numMachineBallots =
        (results.protocol.numMachineBallots || 0) + protocol.numMachineBallots;
    }
    if (protocol.numPaperBallotsFound) {
      results.protocol.numPaperBallotsFound =
        (results.protocol.numPaperBallotsFound || 0) +
        protocol.numPaperBallotsFound;
    }
    if (protocol.numRegisteredVoters) {
      results.protocol.numRegisteredVoters =
        (results.protocol.numRegisteredVoters || 0) +
        protocol.numRegisteredVoters;
    }
    if (protocol.numUnusedPaperBallots) {
      results.protocol.numUnusedPaperBallots =
        (results.protocol.numUnusedPaperBallots || 0) +
        protocol.numUnusedPaperBallots;
    }
    if (protocol.numValidMachineVotes) {
      results.protocol.numValidMachineVotes =
        (results.protocol.numValidMachineVotes || 0) +
        protocol.numValidMachineVotes;
    }
    if (protocol.numValidNoOneMachineVotes) {
      results.protocol.numValidNoOneMachineVotes =
        (results.protocol.numValidNoOneMachineVotes || 0) +
        protocol.numValidNoOneMachineVotes;
    }
    if (protocol.numValidNoOnePaperVotes) {
      results.protocol.numValidNoOnePaperVotes =
        (results.protocol.numValidNoOnePaperVotes || 0) +
        protocol.numValidNoOnePaperVotes;
    }
    if (protocol.numValidVotes) {
      results.protocol.numValidVotes =
        (results.protocol.numValidVotes || 0) + protocol.numValidVotes;
    }
    results.protocol.totalActualVoters =
      (results.protocol.totalActualVoters || 0) + totalActualVoters;
  }
  if (
    results.protocol &&
    (results.protocol.totalActualVoters === undefined ||
      isNaN(results.protocol.totalActualVoters))
  ) {
    throw new Error("Invalid results.protocol.totalActualVoters");
  }
};
