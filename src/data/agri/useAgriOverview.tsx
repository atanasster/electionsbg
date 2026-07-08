// ДФ „Земеделие" national overview — totals by year, scheme + oblast breakdowns,
// concentration curve, and top legal-entity recipients, for one scope. `scope`
// is a financial year ("2023") or "all"; omit (or "") for the default latest
// year. Small payload, staleTime Infinity. 404/empty → null.

import { useQuery } from "@tanstack/react-query";
import { fetchAgriPayload } from "./fetchAgriPayload";
import type { AgriIndexFile } from "./types";

export const useAgriOverview = (scope?: string) =>
  useQuery({
    queryKey: ["agri", "overview", scope ?? ""] as const,
    queryFn: () =>
      fetchAgriPayload<AgriIndexFile>("overview", scope || undefined),
    staleTime: Infinity,
  });
