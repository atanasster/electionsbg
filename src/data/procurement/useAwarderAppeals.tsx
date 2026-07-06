// Per-buyer КЗК (procurement-appeals) summary for the awarder page — the
// arbitrations filed against a contracting authority. Reads the generic
// /api/db/table engine (resource "kzk_appeals", scoped by buyer_eik), so no new
// endpoint or SQL function is needed: aggregates.count gives the totals and a
// small sorted page gives the recent list. Every awarder with appeals gets this
// lifecycle tile alongside the announced-procedures (tenders) one.

import { useQuery } from "@tanstack/react-query";

export interface AwarderAppealRow {
  complaintNo: string;
  complaintDate: string | null;
  unp: string | null;
  complainant: string | null;
  subject: string | null;
  status: string | null;
  outcome: string | null;
  suspension: boolean | null;
}

export interface AwarderAppeals {
  total: number;
  upheld: number;
  suspended: number;
  recent: AwarderAppealRow[];
}

type Filter = { id: string; value: unknown };

const tableQuery = async (
  eik: string,
  extra: Filter[],
  pageSize: number,
): Promise<{ rows: AwarderAppealRow[]; count: number }> => {
  const q = {
    resource: "kzk_appeals",
    page: 0,
    pageSize,
    sort: [{ id: "complaint_date", desc: true }],
    filters: { columns: [{ id: "buyer_eik", value: eik }, ...extra] },
  };
  const r = await fetch(
    `/api/db/table?q=${encodeURIComponent(JSON.stringify(q))}`,
  );
  if (!r.ok) throw new Error(`kzk table fetch failed: ${r.status}`);
  const j = (await r.json()) as {
    rows?: AwarderAppealRow[];
    aggregates?: { count?: number };
  };
  return { rows: j.rows ?? [], count: j.aggregates?.count ?? 0 };
};

const fetchAwarderAppeals = async (eik: string): Promise<AwarderAppeals> => {
  const [base, upheld, suspended] = await Promise.all([
    tableQuery(eik, [], 6),
    tableQuery(eik, [{ id: "outcome", value: ["уважена"] }], 1),
    tableQuery(eik, [{ id: "suspension", value: true }], 1),
  ]);
  return {
    total: base.count,
    upheld: upheld.count,
    suspended: suspended.count,
    recent: base.rows,
  };
};

export const useAwarderAppeals = (eik: string) =>
  useQuery({
    queryKey: ["db", "awarder-appeals", eik] as const,
    queryFn: () => fetchAwarderAppeals(eik),
    enabled: /^\d{9,13}$/.test(eik),
    staleTime: Infinity,
    retry: false,
  });
