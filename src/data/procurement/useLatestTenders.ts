// The most recently announced tender procedures in the current scope — the
// dashboard's pipeline strip. Same /api/db/table engine as the tenders
// browser, newest first. Values are ESTIMATED (forecast), never spend.

import { useQuery } from "@tanstack/react-query";
import { useProcurementWindow } from "./useProcurementWindow";
import { fetchTablePage } from "./fetchTablePage";

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
    queryFn: () =>
      fetchTablePage<LatestTenderRow>({
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
      }),
    staleTime: Infinity,
  });
};
