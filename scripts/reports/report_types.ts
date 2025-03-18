import {
  ElectionInfo,
  PartyInfo,
  RecountOriginal,
  ReportRow,
  SectionProtocol,
  Votes,
} from "@/data/dataTypes";

export type CalcProcProps = {
  votes: Votes[];
  election: ElectionInfo;
  protocol?: SectionProtocol;
  prevYearVotes?: Votes[];
  parties: PartyInfo[];
  prevYearParties?: PartyInfo[];
  original?: RecountOriginal;
};

export const round = (num: number) => Math.ceil(num * 100) / 100;

export type CalcRowType = Pick<
  ReportRow,
  "partyNum" | "totalVotes" | "pctPartyVote" | "value"
>;
