import {
  PartyInfo,
  PartyVotes,
  ReportRow,
  SectionProtocol,
  Votes,
  StatsVote,
  VoteResults,
} from "@/data/dataTypes";
import { findPrevVotes, pctChange, topParty } from "@/data/utils";

const round = (num: number) => Math.ceil(num * 100) / 100;
type FindPartyFunc = (votes: Votes[]) => PartyVotes | undefined;
const topPartyValues = (
  votes: Votes[],
  protocol?: SectionProtocol,
  findParty: FindPartyFunc = topParty,
): Pick<ReportRow, "partyNum" | "totalVotes" | "pctPartyVote"> | undefined => {
  const partyVotes = findParty(votes);
  if (protocol && partyVotes) {
    return {
      partyNum: partyVotes.partyNum,
      totalVotes: partyVotes.totalVotes,
      pctPartyVote: round(
        (100 * partyVotes.totalVotes) /
          ((protocol.numValidVotes || 0) +
            (protocol.numValidMachineVotes || 0)),
      ),
    };
  }
  return undefined;
};
type CalcRowType = Pick<
  ReportRow,
  "partyNum" | "totalVotes" | "pctPartyVote" | "value"
>;
type CalcProcProps = {
  votes: Votes[];
  protocol?: SectionProtocol;
  prevYearVotes?: Votes[];
  parties: PartyInfo[];
  prevYearParties?: PartyInfo[];
  original?: VoteResults;
};

const calcGainsProc = (
  { votes, parties, prevYearParties, prevYearVotes, protocol }: CalcProcProps,
  top: boolean,
) => {
  if (!prevYearVotes) {
    return undefined;
  }
  const prevElectionVotes: StatsVote[] | undefined = prevYearVotes
    ?.map((v) => {
      const p = prevYearParties?.find((p1) => p1.number === v.partyNum);
      if (!p) {
        return undefined;
      }
      const { nickName, number, commonName } = p;
      return { ...v, number, nickName, commonName };
    })
    .filter((p) => p !== undefined);
  const partyVotes: PartyVotes[] = votes.map((v) => {
    const p = parties.find((p1) => p1.number === v.partyNum);
    return { ...v, ...p };
  });
  const changes = partyVotes
    .map((pv) => {
      const { prevTotalVotes } = findPrevVotes(pv, prevElectionVotes, true);
      return prevTotalVotes
        ? {
            ...pv,
            change: 100 * ((pv.totalVotes - prevTotalVotes) / prevTotalVotes),
            prevVotes: prevTotalVotes,
          }
        : undefined;
    })
    .filter((a) => a !== undefined)
    .sort((a, b) => b.change - a.change);
  if (changes.length > 0) {
    const change = top ? changes[0] : changes[changes.length - 1];
    return {
      ...topPartyValues(votes, protocol, (vt) =>
        vt.find((v) => v.partyNum === change.partyNum),
      ),
      value: round(change.change),
      prevYearVotes: change.prevVotes,
    } as CalcRowType;
  }
  return undefined;
};
type ReportValue = {
  name: string;
  direction: "asc" | "desc";
  calc: (p: CalcProcProps) => CalcRowType | undefined;
};

export const reportValues: ReportValue[] = [
  {
    name: "turnout",
    direction: "desc",
    calc: ({ votes, protocol }) => {
      return {
        ...topPartyValues(votes, protocol),
        value: protocol?.numRegisteredVoters
          ? round(
              100 * (protocol.totalActualVoters / protocol.numRegisteredVoters),
            )
          : undefined,
      } as CalcRowType;
    },
  },
  {
    name: "concentrated",
    direction: "desc",
    calc: ({ votes, protocol }) => {
      const topVotes = topPartyValues(votes, protocol);
      return {
        ...topVotes,
        value: topVotes?.pctPartyVote,
      } as CalcRowType;
    },
  },
  {
    name: "additional_voters",
    direction: "desc",
    calc: ({ votes, protocol }) => {
      return {
        ...topPartyValues(votes, protocol),
        value: protocol?.totalActualVoters
          ? round(
              100 *
                ((protocol.numAdditionalVoters || 0) /
                  protocol.totalActualVoters),
            )
          : undefined,
      } as CalcRowType;
    },
  },
  {
    name: "invalid_ballots",
    direction: "desc",
    calc: ({ votes, protocol }) => {
      return {
        ...topPartyValues(votes, protocol),
        value: protocol?.numPaperBallotsFound
          ? round(
              100 *
                ((protocol.numInvalidBallotsFound || 0) /
                  protocol.numPaperBallotsFound),
            )
          : undefined,
      } as CalcRowType;
    },
  },
  {
    name: "supports_noone",
    direction: "desc",
    calc: ({ votes, protocol }) => {
      return {
        ...topPartyValues(votes, protocol),
        value: protocol?.totalActualVoters
          ? 100 *
            round(
              ((protocol.numValidNoOnePaperVotes || 0) +
                (protocol.numValidNoOneMachineVotes || 0)) /
                protocol.totalActualVoters,
            )
          : undefined,
      } as CalcRowType;
    },
  },
  {
    name: "top_gainers",
    direction: "desc",
    calc: (p) => calcGainsProc(p, true),
  },
  {
    name: "top_losers",
    direction: "asc",
    calc: (p) => calcGainsProc(p, false),
  },
  {
    name: "recount",
    direction: "desc",
    calc: ({ votes, protocol, original }) => {
      let value = undefined;
      let topPartyChange = undefined;
      let bottomPartyChange = undefined;
      let pctRecountChange = undefined;

      if (original) {
        value =
          protocol && original?.protocol
            ? (protocol.numValidVotes || 0) +
              (protocol.numValidMachineVotes || 0) -
              ((original.protocol.numValidVotes || 0) +
                (original.protocol.numValidMachineVotes || 0))
            : undefined;
        if (value) {
          pctRecountChange = pctChange(
            protocol?.totalActualVoters,
            original?.protocol?.totalActualVoters,
          );
          topPartyChange = votes.reduce(
            (acc: { change: number; partyNum: number } | undefined, vote) => {
              const originalVotes = original?.votes.find(
                (v) => v.partyNum === vote.partyNum,
              );
              if (
                originalVotes &&
                vote.totalVotes - originalVotes.totalVotes > (acc?.change || 0)
              ) {
                return {
                  partyNum: vote.partyNum,
                  change: vote.totalVotes - originalVotes.totalVotes,
                };
              }
              return acc;
            },
            undefined,
          );
          bottomPartyChange = votes.reduce(
            (acc: { change: number; partyNum: number } | undefined, vote) => {
              const originalVotes = original?.votes.find(
                (v) => v.partyNum === vote.partyNum,
              );
              if (
                originalVotes &&
                vote.totalVotes - originalVotes.totalVotes < (acc?.change || 0)
              ) {
                return {
                  partyNum: vote.partyNum,
                  change: vote.totalVotes - originalVotes.totalVotes,
                };
              }
              return acc;
            },
            undefined,
          );
        }
      }
      return {
        pctRecountChange,
        topPartyChange,
        bottomPartyChange,
        value: value || undefined,
      } as CalcRowType;
    },
  },
];
