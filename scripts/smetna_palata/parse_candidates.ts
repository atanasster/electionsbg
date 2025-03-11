import {
  CandidatesInfo,
  FinancingFromCandidates,
  PartyFilingIncome,
  PartyInfo,
} from "@/data/dataTypes";
import { CandidateDonations } from "./parse_candidate_donations";

export const parseFromCandidates = async ({
  income,
  candidateDonations,
  candidates,
  party,
}: {
  income: PartyFilingIncome;
  candidates: CandidatesInfo[];
  party: PartyInfo;
  candidateDonations: CandidateDonations[];
}): Promise<FinancingFromCandidates[]> => {
  const partyDonations = candidateDonations.filter(
    (d) => d.cik_party_name === party.name,
  );
  const allCandidates: FinancingFromCandidates[] = [];
  partyDonations.forEach((d) => {
    let name = d.candidate_name;
    const nameParts = name
      .toLowerCase()
      .split(" ")
      .filter((s) => s !== "");
    const nameMatches = candidates.find((candidate) => {
      const candidateParts = candidate.name
        .toLowerCase()
        .split(" ")
        .filter((s) => s !== "");
      if (
        nameParts.length === candidateParts.length &&
        nameParts.join(" ") === candidateParts.join(" ")
      ) {
        return true;
      }
      if (
        nameParts.length === 2 &&
        candidateParts.length === 3 &&
        nameParts[0] === candidateParts[0] &&
        nameParts[1] === candidateParts[2]
      ) {
        return true;
      }
      return false;
    });
    if (nameMatches) {
      name = nameMatches.name;
    } else {
      name = nameParts
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
    }

    const date = d.date;
    const goal = d.kind;
    const monetary = d.monetary;
    const nonMonetary = d.nonMonetary;

    allCandidates.push({
      name,
      date,
      monetary,
      nonMonetary,
      goal,
    });
  });
  if (income.candidates.monetary === 0 && income.candidates.nonMonetary === 0) {
    const { monetary, nonMonetary } = allCandidates.reduce(
      (acc, curr) => {
        return {
          monetary: acc.monetary + curr.monetary,
          nonMonetary: acc.nonMonetary + curr.nonMonetary,
        };
      },
      {
        monetary: 0,
        nonMonetary: 0,
      },
    );
    income.candidates.monetary = monetary;
    income.candidates.nonMonetary = nonMonetary;
  }
  return allCandidates;
};
