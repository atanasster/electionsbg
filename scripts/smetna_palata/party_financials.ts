import { CandidatesInfo, PartyInfo } from "@/data/dataTypes";
import { parseDonors } from "./parse_donors";
import { parseFromParties } from "./parse_parties";
import { parseFromCandidates } from "./parse_candidates";
import { parseFiling } from "./parse_filing";

export const parsePartyFinancing = async ({
  dataFolder,
  candidates,
}: {
  dataFolder: string;
  party: PartyInfo;
  candidates: CandidatesInfo[];
}) => {
  const filing = await parseFiling({ dataFolder });
  const fromDonors = await parseDonors({ income: filing.income, dataFolder });
  const fromParties = await parseFromParties({
    income: filing.income,
    dataFolder,
  });
  const fromCandidates = await parseFromCandidates({
    income: filing.income,
    dataFolder,
    candidates,
  });
  return { fromDonors, fromParties, fromCandidates, filing };
};
