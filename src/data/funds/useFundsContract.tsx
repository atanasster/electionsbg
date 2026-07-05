// EU-funds (ИСУН) per-contract drill-down — one tiny shard per signed
// contract (~1-2 KB). Backs the /funds/contract/{number} page.
//
// ContractNumber characters are restricted to [-.0-9A-Z] (verified at
// ingest), so the raw value is safe both as a filename and as a URL path
// segment. We still encodeURIComponent for defence in depth.

import { useQuery } from "@tanstack/react-query";
import { fetchFundContract } from "./fetchFundPayload";
import type { FundsProjectsContractFile } from "./types";

const fetchContract = (
  number: string,
): Promise<FundsProjectsContractFile | null> =>
  fetchFundContract<FundsProjectsContractFile>(number);

export const useFundsContract = (number: string | undefined) =>
  useQuery({
    queryKey: ["funds", "projects", "contract", number ?? ""] as const,
    queryFn: () => fetchContract(number!),
    enabled: !!number,
    staleTime: Infinity,
  });
