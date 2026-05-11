import {
  ElectionInfo,
  ElectionMunicipality,
  ElectionSettlement,
  PartyInfo,
  RecountOriginal,
  ReportRow,
  SectionInfo,
  SectionProtocol,
  Votes,
} from "@/data/dataTypes";

export type DataTypes = ElectionMunicipality | ElectionSettlement | SectionInfo;

export type CalcProcProps<DType extends DataTypes> = {
  votes: Votes[];
  data: DType;
  election: ElectionInfo;
  protocol?: SectionProtocol;
  prevYearVotes?: Votes[];
  parties: PartyInfo[];
  prevYearParties?: PartyInfo[];
  original?: RecountOriginal;
  // partyNums that fell below the 4% national threshold this cycle;
  // populated by generateReports() once per election, before per-level
  // reports run, so wasted_votes can filter by it.
  belowThresholdPartyNums?: Set<number>;
};

export const round = (num: number) => Math.ceil(num * 100) / 100;

export type CalcRowType = Pick<
  ReportRow,
  "partyNum" | "totalVotes" | "pctPartyVote" | "value"
>;
