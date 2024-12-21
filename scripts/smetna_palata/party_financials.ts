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
  const fromDonors = await parseDonors({ dataFolder });
  const fromParties = await parseFromParties({ dataFolder });
  const fromCandidates = await parseFromCandidates({ dataFolder });
  return { fromDonors, fromParties, fromCandidates, filing };
  // console.log(fromParties);
};
