// The most recently announced tender procedures in the current scope — the
// dashboard's pipeline strip. Same /api/db/table engine as the tenders
// browser, newest first. Values are ESTIMATED (forecast), never spend.

import { useQuery } from "@tanstack/react-query";
import { useProcurementWindow } from "./useProcurementWindow";

export type LatestTenderRow = {
  unp: string;
  publicationDate: string;
  buyerEik: string;
  buyerName: string;
  subject: string;
  estimatedValueEur: number | null;
};

export const useLatestTenders = (count = 5) => {
  const { from, to, all } = useProcurementWindow();
  return useQuery({
    queryKey: ["procurement", "latest_tenders", from, to, count],
    queryFn: async (): Promise<LatestTenderRow[]> => {
      const request = {
        resource: "tenders",
        page: 0,
        pageSize: count,
        sort: [{ id: "publication_date", desc: true }],
        filters: {
          columns:
            !all && from
              ? [{ id: "publication_date", min: from, max: to ?? undefined }]
              : [],
        },
      };
      const r = await fetch(
        `/api/db/table?q=${encodeURIComponent(JSON.stringify(request))}`,
      );
      if (!r.ok) throw new Error(`table fetch failed: ${r.status}`);
      const j = (await r.json()) as { rows?: LatestTenderRow[] };
      return j.rows ?? [];
    },
    staleTime: Infinity,
  });
};
