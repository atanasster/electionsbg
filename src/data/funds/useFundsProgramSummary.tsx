// EU-funds (ИСУН) per-programme summary — slim "drill-down-ready" snapshot
// for one programme. Backs the `/funds/programme/{code}` page. The full
// by-program/{code}.json shard (some are 45 MB for the Иновации
// programme) lives in the bucket for power users; this summary is ~10-20 KB
// per programme.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { FundsProjectsProgramSummaryFile } from "./types";

const fetchSummary = async (
  code: string,
): Promise<FundsProjectsProgramSummaryFile | null> => {
  const r = await fetch(
    dataUrl(`/funds/projects/by-program/${code}-summary.json`),
  );
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as FundsProjectsProgramSummaryFile;
};

export const useFundsProgramSummary = (code: string | undefined) =>
  useQuery({
    queryKey: ["funds", "projects", "program", code ?? ""] as const,
    queryFn: () => fetchSummary(code!),
    enabled: !!code,
    staleTime: Infinity,
  });
