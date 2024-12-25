import { PartyInfo } from "@/data/dataTypes";
import { parseDonors } from "./parse_donors";
import { parseFromParties } from "./parse_parties";
import { parseFromCandidates } from "./parse_candidates";
import { parseFiling } from "./parse_filing";

export const parsePartyFinancing = async ({
  dataFolder,
}: {
  dataFolder: string;
  party: PartyInfo;
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
  });
  return { fromDonors, fromParties, fromCandidates, filing };
};
