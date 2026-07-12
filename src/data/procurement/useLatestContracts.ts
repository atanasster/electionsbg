// The most recent big contracts in the current scope — the dashboard's
// "what was just signed" strip. One /api/db/table page (the same engine as
// the contracts browser), newest first, primary contracts only, floored at
// €100k so routine small purchases don't drown the signal.

import { useQuery } from "@tanstack/react-query";
import { useScopeWindow } from "@/data/scope/useScopeWindow";
import { fetchTablePage } from "./fetchTablePage";
import type { ProcurementContract } from "@/data/dataTypes";

const MIN_EUR = 100_000;

export const useLatestContracts = (count = 6) => {
  const { from, to, all } = useScopeWindow();
  return useQuery({
    queryKey: ["procurement", "latest_contracts", from, to, count],
    queryFn: () =>
      fetchTablePage<ProcurementContract>({
        resource: "contracts",
        page: 0,
        pageSize: count,
        sort: [{ id: "date", desc: true }],
        filters: {
          columns: [
            { id: "tag", value: ["contract"] },
            { id: "amount_eur", min: MIN_EUR },
            ...(!all && from
              ? [{ id: "date", min: from, max: to ?? undefined }]
              : []),
          ],
        },
      }),
    staleTime: Infinity,
  });
};
