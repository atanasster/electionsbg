// National "recent КЗК appeals" feed, DB-backed (/api/db/kzk-appeals →
// kzk_recent_appeals from schema 042). Each row is a procurement complaint,
// joined to its tender by УНП (exact) where resolved. Corpus-wide (not windowed).

import { useQuery } from "@tanstack/react-query";

export type KzkRecentAppeal = {
  complaintNo: string;
  complaintDate: string | null;
  unp: string | null;
  buyerEik: string | null;
  buyerName: string | null;
  complainant: string | null;
  subject: string | null;
  vmRequested: boolean | null;
  status: string | null;
  outcome: string | null;
  suspension: boolean | null;
  resolved: boolean;
};

export const useKzkRecentAppeals = (limit = 30) =>
  useQuery({
    queryKey: ["procurement", "kzk_recent_appeals", limit] as const,
    queryFn: async (): Promise<KzkRecentAppeal[]> => {
      const r = await fetch(`/api/db/kzk-appeals?limit=${limit}`);
      // Migration lag (404) → empty feed (tile hides). Any OTHER non-OK status
      // (500/503) is a transient outage — throw so `[]` isn't cached as a fresh
      // success (staleTime: Infinity); retry:false prevents a storm and it
      // refetches on next mount.
      if (r.status === 404) return [];
      if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
      return (await r.json()) as KzkRecentAppeal[];
    },
    staleTime: Infinity,
    retry: false,
  });
