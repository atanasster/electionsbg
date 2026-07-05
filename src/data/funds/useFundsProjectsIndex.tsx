// EU-funds (ИСУН) contract-level corpus index — totals, per-programme and
// per-status rollups, and the location-kind histogram. Backs the "Проекти"
// section on /funds. Sibling of useFundsIndex (which fetches the
// beneficiary-rollup index).

import { useQuery } from "@tanstack/react-query";
import { fetchFundPayload } from "./fetchFundPayload";
import type { FundsProjectsIndexFile } from "./types";

const fetchIndex = (): Promise<FundsProjectsIndexFile | null> =>
  fetchFundPayload<FundsProjectsIndexFile>("projects-index");

export const useFundsProjectsIndex = () =>
  useQuery({
    queryKey: ["funds", "projects", "index"] as const,
    queryFn: fetchIndex,
    staleTime: Infinity,
  });
