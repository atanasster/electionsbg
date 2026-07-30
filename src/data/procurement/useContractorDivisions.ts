// The CPV divisions present in the current scope, with contractor counts — feeds the
// CpvFilterCombobox `divisions` prop on /procurement/contractors. A facet over the
// contractor_rank `division` column (via /api/db/facets); the engine suppresses the
// 'ALL' defaultFilter for a column it is faceting (skipDefaultFilterCols), so this
// enumerates every division rather than collapsing to the rollup. The 'ALL' bucket is
// dropped here — it is the rollup sentinel, not a selectable division.

import { useQuery } from "@tanstack/react-query";
import { useScopeWindow } from "@/data/scope/useScopeWindow";
import { DIVISION_ALL } from "./useUrlContractorFilters";

export interface DivisionOption {
  value: string;
  count: number;
}

const fetchDivisions = async (scopeKey: string): Promise<DivisionOption[]> => {
  const req = {
    resource: "contractor_rankings",
    scope: { col: "scope_key", val: scopeKey },
    columns: ["division"],
    limit: 60,
  };
  const r = await fetch(
    `/api/db/facets?q=${encodeURIComponent(JSON.stringify(req))}`,
  );
  if (!r.ok) return [];
  const body = (await r.json()) as {
    facets?: { division?: DivisionOption[] };
  };
  return (body.facets?.division ?? []).filter((d) => d.value !== DIVISION_ALL);
};

export const useContractorDivisions = () => {
  const { scopeKey } = useScopeWindow();
  return useQuery({
    queryKey: ["contractor-divisions", scopeKey],
    queryFn: () => fetchDivisions(scopeKey),
    staleTime: Infinity,
  });
};
