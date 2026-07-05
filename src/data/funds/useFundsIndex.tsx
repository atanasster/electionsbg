// EU-funds (ИСУН) index — corpus totals, by-org-type / by-org-form
// breakdowns, top beneficiaries, and the MP cross-reference summary.
// Small file; fetched as-is. Renders nothing-friendly: 404 → null.

import { useQuery } from "@tanstack/react-query";
import { fetchFundPayload } from "./fetchFundPayload";
import type { FundsIndexFile } from "./types";

const fetchIndex = (): Promise<FundsIndexFile | null> =>
  fetchFundPayload<FundsIndexFile>("index");

export const useFundsIndex = () =>
  useQuery({
    queryKey: ["funds", "index"] as const,
    queryFn: fetchIndex,
    staleTime: Infinity,
  });
