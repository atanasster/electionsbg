// EU-funds (ИСУН) contract-level corpus index — totals, per-programme and
// per-status rollups, and the location-kind histogram. Backs the "Проекти"
// section on /funds. Sibling of useFundsIndex (which fetches the
// beneficiary-rollup index).

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { FundsProjectsIndexFile } from "./types";

const fetchIndex = async (): Promise<FundsProjectsIndexFile | null> => {
  const r = await fetch(dataUrl("/funds/projects/index.json"));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as FundsProjectsIndexFile;
};

export const useFundsProjectsIndex = () =>
  useQuery({
    queryKey: ["funds", "projects", "index"] as const,
    queryFn: fetchIndex,
    staleTime: Infinity,
  });
