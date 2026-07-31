// ДФ „Земеделие" national overview — totals by year, scheme + oblast breakdowns,
// concentration curve, and top legal-entity recipients, for one scope. `scope`
// is a financial year ("2023") or "all"; omit (or "") for the default latest
// year. Small payload, staleTime Infinity. 404/empty → null.
//
// `null` (from agriScopeToKey, for a year outside AGRI_FINANCIAL_YEARS) disables
// the query: there is no payload to fetch, so the caller renders the no-data
// state directly. Note the query is then pending-but-idle — `isLoading` is
// false, `data` undefined — so a caller MUST NOT treat "no data" as "loading".
//
// It also gets its OWN cache key. Folding it into the `""` (default latest year)
// key made the disabled query read that entry's cached payload and hand it back
// as if it were the answer — so switching from the default scope to an
// uncovered year silently re-served the latest year under the year the reader
// picked, which is the same lie the skeleton told, just better dressed.

import { useQuery } from "@tanstack/react-query";
import { fetchAgriPayload } from "./fetchAgriPayload";
import type { AgriIndexFile } from "./types";

export const useAgriOverview = (scope?: string | null) =>
  useQuery({
    queryKey: ["agri", "overview", scope === null ? "(none)" : (scope ?? "")],
    queryFn: () =>
      fetchAgriPayload<AgriIndexFile>("overview", scope || undefined),
    enabled: scope !== null,
    staleTime: Infinity,
  });
