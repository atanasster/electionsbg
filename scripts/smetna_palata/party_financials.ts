import { CandidatesInfo, PartyInfo } from "@/data/dataTypes";
import { parseDonors } from "./parse_donors";
import { parseFromParties } from "./parse_parties";
import { parseFromCandidates } from "./parse_candidates";
import { parseFiling } from "./parse_filing";
import { CandidateDonations } from "./parse_candidate_donations";

export const parsePartyFinancing = async ({
  dataFolder,
  candidates,
  party,
  candidateDonations,
}: {
  dataFolder: string;
  party: PartyInfo;
  candidates: CandidatesInfo[];
  candidateDonations: CandidateDonations[];
}) => {
  const filing = await parseFiling({ dataFolder });
  const fromDonors = await parseDonors({ income: filing.income, dataFolder });
  const fromParties = await parseFromParties({
    income: filing.income,
    dataFolder,
  });
  const fromCandidates = await parseFromCandidates({
    income: filing.income,
    party,
    candidates,
    candidateDonations,
  });
  return { fromDonors, fromParties, fromCandidates, filing };
};
