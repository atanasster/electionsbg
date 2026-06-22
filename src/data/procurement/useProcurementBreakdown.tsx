// Per-entity sector / procedure / EU-funding breakdown for /company/:eik
// (kind "c") and /awarder/:eik (kind "a"). 404 ⇒ null (the entity had too few
// CPV-coded contracts for a breakdown shard) ⇒ the tile renders nothing.

import { useQuery } from "@tanstack/react-query";
import type { ProcurementBreakdown } from "@/data/dataTypes";
import { dataUrl } from "@/data/dataUrl";

const fetchBreakdown = async (
  kind: "c" | "a",
  eik: string,
): Promise<ProcurementBreakdown | null> => {
  const r = await fetch(
    dataUrl(`/procurement/derived/breakdowns/${kind}/${eik}.json`),
  );
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as ProcurementBreakdown;
};

export const useProcurementBreakdown = (kind: "c" | "a", eik?: string | null) =>
  useQuery({
    queryKey: ["procurement", "breakdown", kind, eik] as const,
    queryFn: () => fetchBreakdown(kind, eik as string),
    enabled: !!eik,
    staleTime: Infinity,
  });
