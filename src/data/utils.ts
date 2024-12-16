import {
  ElectionResults,
  PartyInfo,
  PartyVotes,
  SectionProtocol,
  StatsVote,
  VoteResults,
  Votes,
} from "./dataTypes";

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

export const addVotes = (votes: Votes[], initial?: Votes[]) => {
  const buff: Votes[] = initial || [];
  votes.forEach((v) => {
    const votes = buff.find((a) => a.partyNum === v.partyNum);
    if (votes) {
      votes.totalVotes += v.totalVotes;
      if (v.machineVotes) {
        votes.machineVotes = (votes.machineVotes || 0) + v.machineVotes;
      }
      if (v.paperVotes) {
        votes.paperVotes = (votes.paperVotes || 0) + v.paperVotes;
      }
    } else {
      buff.push({
        ...v,
        partyNum: v.partyNum,
        totalVotes: v.totalVotes,
        machineVotes: v.machineVotes,
        paperVotes: v.paperVotes,
      });
    }
  });
  return buff;
};
export const addResults = (
  results: VoteResults,
  votes: Votes[],
  protocol?: SectionProtocol,
) => {
  results.votes = addVotes(votes, results.votes);
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

export const localDate = (date: string) => {
  const dateS = date.split("_");
  const dateObj = new Date(
    parseInt(dateS[0]),
    parseInt(dateS[1]) - 1,
    parseInt(dateS[2]),
  );
  return dateObj.toLocaleDateString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
};

export const findPrevVotes = (
  party: PartyVotes | PartyInfo,
  prevElectionVotes?: StatsVote[],
  consolidateVotes?: boolean,
) => {
  return prevElectionVotes?.reduce((acc: number | undefined, pr) => {
    if (
      pr.nickName === party.nickName ||
      (consolidateVotes
        ? (pr.commonName &&
            party.nickName &&
            pr.commonName.includes(party.nickName)) ||
          (party.commonName && party.commonName.includes(pr.nickName))
        : (pr.commonName?.length && pr.commonName[0] === party.nickName) ||
          (party.commonName?.length && party.commonName[0] === pr.nickName))
    ) {
      return (acc || 0) + pr.totalVotes;
    }
    return acc;
  }, undefined);
};

export const topParty = (votes?: Votes[]): PartyVotes | undefined => {
  const tp = votes?.reduce((acc, curr) => {
    if (acc.totalVotes > curr.totalVotes) {
      return acc;
    }
    return curr;
  }, votes[0]);

  return tp;
};

export const totalActualVoters = (votes?: Votes[]): number | undefined => {
  return votes?.reduce((acc, curr) => acc + curr.totalVotes, 0);
};

export const minMaxVotes = (votes?: ElectionResults[]) => {
  return votes
    ? votes.reduce(
        (acc, v) => {
          const totalVotes = totalActualVoters(v.results.votes);
          return {
            maxVotes: Math.max(acc.maxVotes, totalVotes || 0),
            minVotes: Math.min(acc.maxVotes, totalVotes || Infinity),
          };
        },
        { maxVotes: 0, minVotes: Infinity },
      )
    : { maxVotes: 0, minVotes: 0 };
};
