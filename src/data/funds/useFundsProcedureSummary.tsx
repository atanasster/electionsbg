// EU-funds (ИСУН) per-procedure summary — the grain between a programme and a
// single contract (`BG16RFOP002-2.089`). Backs the `/funds/procedure/{code}`
// page. ~5-55 KB per procedure; the full contract list stays in the corpus.

import { useQuery } from "@tanstack/react-query";
import { fetchFundPayload } from "./fetchFundPayload";
import type { FundsProjectsProcedureSummaryFile } from "./types";

const fetchSummary = (
  code: string,
): Promise<FundsProjectsProcedureSummaryFile | null> =>
  fetchFundPayload<FundsProjectsProcedureSummaryFile>("procedure", code);

export const useFundsProcedureSummary = (code: string | undefined) =>
  useQuery({
    queryKey: ["funds", "projects", "procedure", code ?? ""] as const,
    queryFn: () => fetchSummary(code!),
    enabled: !!code,
    staleTime: Infinity,
  });
