import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useElectionContext } from "../ElectionContext";
import { dataUrl } from "@/data/dataUrl";

// First-digit (1BL) or second-digit (2BL) Benford test result for one
// party in one election. Observed/expected are share-space arrays.
export type BenfordTest = {
  observed: number[];
  expected: number[];
  n: number;
  chi2: number;
  pValue: number;
  mad: number;
};

export type BenfordPartyEntry = {
  partyNum: number;
  nickName: string;
  name?: string;
  name_en?: string;
  color?: string;
  totalSections: number;
  firstDigit?: BenfordTest;
  secondDigit?: BenfordTest;
};

export type BenfordReport = {
  election: string;
  generatedAt: string;
  thresholds: {
    minVotes1BL: number;
    minVotes2BL: number;
  };
  parties: BenfordPartyEntry[];
};

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined]
>): Promise<BenfordReport | null> => {
  if (!queryKey[1]) return null;
  const response = await fetch(dataUrl(`/${queryKey[1]}/reports/benford.json`));
  if (!response.ok) return null;
  return response.json();
};

export const useBenford = () => {
  const { selected } = useElectionContext();
  return useQuery({
    queryKey: ["benford", selected],
    queryFn,
  });
};
