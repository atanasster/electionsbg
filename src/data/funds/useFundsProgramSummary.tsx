// EU-funds (ИСУН) per-programme summary — slim "drill-down-ready" snapshot
// for one programme. Backs the `/funds/programme/{code}` page. The full
// by-program/{code}.json shard (some are 45 MB for the Иновации
// programme) lives in the bucket for power users; this summary is ~10-20 KB
// per programme.

import { useQuery } from "@tanstack/react-query";
import { fetchFundPayload } from "./fetchFundPayload";
import type { FundsProjectsProgramSummaryFile } from "./types";

const fetchSummary = (
  code: string,
): Promise<FundsProjectsProgramSummaryFile | null> =>
  fetchFundPayload<FundsProjectsProgramSummaryFile>("program-summary", code);

export const useFundsProgramSummary = (code: string | undefined) =>
  useQuery({
    queryKey: ["funds", "projects", "program", code ?? ""] as const,
    queryFn: () => fetchSummary(code!),
    enabled: !!code,
    staleTime: Infinity,
  });
