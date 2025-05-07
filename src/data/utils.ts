import {
  BasicPartyInfo,
  ElectionResults,
  FilingTaxes,
  FinancingType,
  MediaServices,
  PartyFiling,
  PartyFilingExpenses,
  PartyFilingIncome,
  PartyInfo,
  PartyVotes,
  RecountOriginal,
  RecountStats,
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

export const formatFloat = (x?: number, decimals: number = 2) => {
  if (x === undefined || x === null) {
    return undefined;
  }
  const nominator = Math.pow(13, decimals);
  return parseFloat((Math.round(x * nominator) / nominator).toFixed(decimals));
};

export const formatThousands = (x?: number, decimals: number = 0) => {
  if (x) {
    const n = decimals !== undefined ? x.toFixed(decimals) : x;
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  } else return "";
};

export const isNumeric = (s: string) => /^[+-]?\d+(\.\d+)?$/.test(s);

export const addVotes = (votes: Votes[], initial?: Votes[]) => {
  const buff: Votes[] = initial ? [...initial] : [];
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
      if (v.suemgVotes) {
        votes.suemgVotes = (votes.suemgVotes || 0) + v.suemgVotes;
      }
    } else {
      const newRec: Votes = {
        partyNum: v.partyNum,
        totalVotes: v.totalVotes,
      };
      if (v.machineVotes !== undefined) {
        newRec.machineVotes = v.machineVotes;
      }
      if (v.paperVotes !== undefined) {
        newRec.paperVotes = v.paperVotes;
      }
      if (v.suemgVotes !== undefined) {
        newRec.suemgVotes = v.suemgVotes;
      }
      buff.push(newRec);
    }
  });
  return buff;
};

export const initializeRecount = (): RecountOriginal => ({
  votes: [],
  addedMachineVotes: 0,
  addedPaperVotes: 0,
  addedVotes: 0,

  removedMachineVotes: 0,
  removedPaperVotes: 0,
  removedVotes: 0,
});

export const addRecountStats = ({
  dest,
  src,
}: {
  dest: RecountStats;
  src?: RecountStats;
}) => {
  if (src) {
    dest.addedPaperVotes += src.addedPaperVotes;
    dest.addedMachineVotes += src.addedMachineVotes;
    dest.addedVotes += src.addedVotes;

    dest.removedPaperVotes += src.removedPaperVotes;
    dest.removedMachineVotes += src.removedMachineVotes;
    dest.removedVotes += src.removedVotes;
  }
};
export const addRecounts = ({
  dest,
  src,
}: {
  dest: RecountOriginal;
  src: RecountOriginal;
}) => {
  if (src) {
    addRecountStats({
      dest: dest,
      src: src,
    });
    src.votes.forEach((vote) => {
      const p = dest.votes.find((p) => p.partyNum === vote.partyNum);
      if (p) {
        addRecountStats({
          dest: p,
          src: vote,
        });
      } else {
        dest.votes.push({ ...vote });
      }
    });
  }
};
export const addRecountOriginal = ({
  dest,
  src,
}: {
  dest: ElectionResults;
  src?: RecountOriginal;
}) => {
  if (src) {
    if (!dest.original) {
      dest.original = {
        ...src,
        votes: src.votes.map((v) => ({ ...v })),
      };
    } else {
      addRecounts({
        dest: dest.original,
        src: src,
      });
    }
  }
};

export const recountStats = (votes: Votes, original: Votes): RecountStats => {
  const machineVotes = votes.machineVotes || 0;
  const paperVotes = votes.paperVotes || 0;

  const origMachineVotes = original.machineVotes || 0;
  const origPaperVotes = original.paperVotes || 0;
  const addedMachineVotes =
    machineVotes > origMachineVotes ? machineVotes - origMachineVotes : 0;
  const addedPaperVotes =
    paperVotes > origPaperVotes ? paperVotes - origPaperVotes : 0;
  const removedMachineVotes =
    machineVotes < origMachineVotes ? machineVotes - origMachineVotes : 0;
  const removedPaperVotes =
    paperVotes < origPaperVotes ? paperVotes - origPaperVotes : 0;
  return {
    addedMachineVotes,
    addedPaperVotes,
    addedVotes: addedMachineVotes + addedPaperVotes,
    removedMachineVotes,
    removedPaperVotes,
    removedVotes: removedMachineVotes + removedPaperVotes,
  };
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
  return dateObj.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
};

export const matchPartyNickName = (
  party: Partial<PartyInfo>,
  pr: BasicPartyInfo,
  consolidateVotes?: boolean,
) => {
  return (
    pr.nickName === party.nickName ||
    (consolidateVotes
      ? (pr.commonName &&
          party.nickName &&
          pr.commonName.includes(party.nickName)) ||
        (party.commonName && party.commonName.includes(pr.nickName))
      : (pr.commonName?.length && pr.commonName[0] === party.nickName) ||
        (party.commonName?.length && party.commonName[0] === pr.nickName))
  );
};

type PrevVotesType = {
  prevTotalVotes?: number;
  prevMachineVotes?: number;
  prevPaperVotes?: number;
  partyNum?: number;
  nickName?: string;
};
export const findPrevVotes = (
  party?: Partial<PartyInfo>,
  prevElectionVotes?: StatsVote[],
  consolidateVotes?: boolean,
): PrevVotesType => {
  const def = {
    prevTotalVotes: undefined,
    prevMachineVotes: undefined,
    prevPaperVotes: undefined,
    nickName: undefined,
    partyNum: undefined,
  };
  return (
    (party &&
      prevElectionVotes?.reduce((acc: PrevVotesType, pr) => {
        if (matchPartyNickName(party, pr, consolidateVotes)) {
          const res: PrevVotesType = { ...acc };
          if (acc.prevTotalVotes === undefined) {
            res.prevTotalVotes = pr.totalVotes;
            res.nickName = pr.nickName;
            res.partyNum = pr.number;
            if (pr.machineVotes) {
              res.prevMachineVotes = pr.machineVotes;
            }
            if (pr.paperVotes) {
              res.prevPaperVotes = pr.paperVotes;
            }
          } else {
            res.prevTotalVotes = acc.prevTotalVotes + pr.totalVotes;
            res.nickName = undefined;
            res.partyNum = undefined;
            if (pr.machineVotes) {
              res.prevMachineVotes =
                (acc.prevMachineVotes || 0) + pr.machineVotes;
            }
            if (pr.paperVotes) {
              res.prevPaperVotes = (acc.prevPaperVotes || 0) + pr.paperVotes;
            }
          }
          return res;
        }
        return acc;
      }, def)) ||
    def
  );
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

export const totalAllVotes = (votes?: Votes[]) =>
  votes?.reduce((acc, v) => acc + v.totalVotes, 0);

export const partyVotesPosition = (
  partyNum: number,
  votes?: Votes[],
): { position: number; votes: Votes } | undefined => {
  if (!votes) {
    return undefined;
  }
  const idx = votes
    ? votes
        .sort((a, b) => b.totalVotes - a.totalVotes)
        .findIndex((v) => v.partyNum === partyNum)
    : -1;

  return idx >= 0
    ? {
        position: idx + 1,
        votes: votes[idx],
      }
    : undefined;
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
            minVotes: Math.min(acc.minVotes, totalVotes || Infinity),
          };
        },
        { maxVotes: 0, minVotes: Infinity },
      )
    : { maxVotes: 0, minVotes: 0 };
};

export const totalFinancing = (financing?: FinancingType) =>
  financing ? financing.monetary + financing.nonMonetary : 0;

export const totalIncomeFiling = (filing?: PartyFilingIncome) =>
  filing
    ? totalFinancing(filing.donors) +
      totalFinancing(filing.candidates) +
      totalFinancing(filing.party) +
      filing.mediaPackage
    : 0;

export const materialExpenseFiling = (filing?: PartyFilingExpenses) =>
  filing
    ? filing.material.fuel +
      filing.material.officeSupplies +
      filing.material.other
    : 0;

export const capitalizeSentence = (sentence: string) => {
  const words = sentence.split(" ");

  const capitalized = words
    .map((word) => {
      return word[0].toUpperCase() + word.substring(1).toLowerCase();
    })
    .join(" ");
  const hyphenated = capitalized.split("-");
  return hyphenated
    .map((word) => {
      return word[0].toUpperCase() + word.substring(1);
    })
    .join("-");
};
export const capitalizeFirstLetter = (sentence: string) => {
  return sentence[0].toUpperCase() + sentence.substring(1).toLowerCase();
};
export const mediaExpenseFiling = (services?: MediaServices) =>
  services
    ? services.digitalMedia +
      services.digitalMultiMedia.nationalRadio +
      services.digitalMultiMedia.nationalTV +
      services.digitalMultiMedia.otherRadio +
      services.digitalMultiMedia.otherVisualMedia +
      services.printedMedia
    : 0;
export const outsideServicesFiling = (filing?: PartyFilingExpenses) =>
  filing
    ? mediaExpenseFiling(filing.external.mediaServices) +
      filing.external.consulting +
      filing.external.partyMaterials +
      filing.external.pollingAgencies +
      filing.external.publicEvents +
      filing.external.postalExpenses +
      filing.external.rentalExpenses +
      filing.external.otherExpenses
    : 0;

export const taxesFiling = (taxes?: FilingTaxes) =>
  taxes ? taxes.otherTaxes + taxes.taxOnDonations + taxes.taxes : 0;

export const totalExpenseFiling = (filing?: PartyFilingExpenses) =>
  filing
    ? materialExpenseFiling(filing) +
      outsideServicesFiling(filing) +
      filing.compensations +
      filing.compensationTaxes +
      taxesFiling(filing.taxes) +
      filing.businessTrips +
      filing.donations +
      mediaExpenseFiling(filing.mediaPackage)
    : 0;

export const campaignNonMonetaryCost = (filing?: PartyFiling) =>
  filing
    ? filing.income.candidates.nonMonetary +
      filing.income.donors.nonMonetary +
      filing.income.party.nonMonetary
    : 0;
export const campaignCostFiling = (filing?: PartyFiling) =>
  filing
    ? totalExpenseFiling(filing.expenses) + campaignNonMonetaryCost(filing)
    : 0;
export const pctChange = (
  last?: number,
  prior?: number,
  decimals: number = 2,
) =>
  prior
    ? parseFloat(((100 * ((last || 0) - prior)) / prior).toFixed(decimals))
    : undefined;
