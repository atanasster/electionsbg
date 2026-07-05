import { CandidatesInfo, PartyInfo } from "@/data/dataTypes";
import { parseDonors } from "./parse_donors";
import { parseFromParties } from "./parse_parties";
import { parseFromCandidates } from "./parse_candidates";
import { parseFiling } from "./parse_filing";
import { CandidateDonations } from "./parse_candidate_donations";
import { ParsedAgency } from "./parse_agencies";

export const parsePartyFinancing = async ({
  dataFolder,
  candidates,
  party,
  candidateDonations,
  agencies,
}: {
  dataFolder: string;
  party: PartyInfo;
  candidates: CandidatesInfo[];
  candidateDonations: CandidateDonations[];
  agencies: ParsedAgency[];
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
  // Election-wide agencies filtered to this party (drop the join key).
  const partyAgencies = agencies
    .filter((a) => a.cik_party_name === party.name)
    .map((a) => ({ name: a.name, eik: a.eik, type: a.type, descr: a.descr }));
  return {
    fromDonors,
    fromParties,
    fromCandidates,
    agencies: partyAgencies,
    filing,
  };
};
