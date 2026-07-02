// Per-EIK MP-connection lookup — DB-backed (/api/db/company-politicians →
// company_politicians). One request per EIK, shared with the officials hook
// via the same query key, replacing the manifest + per-EIK JSON shard pair.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ProcurementRelation } from "@/data/dataTypes";

export type CompanyPoliticianRow = {
  politician: string;
  ref: string;
  kind: "mp" | "official";
  role: string | null;
  /** Full relation detail from the connections pipeline — MP rows carry the
   *  {kind, isCurrent?, shareSize?, confidence?} shape, official rows the
   *  {role, …} shape. */
  relations: Array<Record<string, unknown>> | null;
  totalEur: number | null;
};

/** Chip-grade MP entry: who, link id, and the declared relation(s). */
export type MpConnectedChipEntry = {
  mpId: number;
  mpName: string;
  relations: ProcurementRelation[];
};

const fetchCompanyPoliticians = async (
  eik: string,
): Promise<CompanyPoliticianRow[]> => {
  const r = await fetch(
    `/api/db/company-politicians?eik=${encodeURIComponent(eik)}`,
  );
  if (!r.ok) return [];
  const j = (await r.json()) as { entries?: CompanyPoliticianRow[] };
  return j.entries ?? [];
};

export const useCompanyPoliticians = (eik?: string | null) =>
  useQuery({
    queryKey: ["db", "company-politicians", eik ?? ""] as const,
    queryFn: () => fetchCompanyPoliticians(eik as string),
    enabled: !!eik,
    staleTime: Infinity,
    retry: false,
  });

export const useProcurementMpConnectedByEik = (
  eik?: string | null,
): { entries: MpConnectedChipEntry[]; isLoading: boolean } => {
  const { data, isLoading } = useCompanyPoliticians(eik);

  const entries = useMemo<MpConnectedChipEntry[]>(() => {
    const byMp = new Map<number, MpConnectedChipEntry>();
    for (const row of data ?? []) {
      if (row.kind !== "mp") continue;
      const m = /^\/candidate\/mp-(\d+)$/.exec(row.ref);
      if (!m) continue;
      const mpId = Number(m[1]);
      const prior = byMp.get(mpId) ?? {
        mpId,
        mpName: row.politician,
        relations: [],
      };
      // Prefer the full relations jsonb (keeps isCurrent/shareSize/confidence
      // → "(former)" / "declared stake N%" labels); fall back to the flat
      // role column for rows loaded before the relations column existed.
      if (row.relations && row.relations.length > 0) {
        prior.relations.push(
          ...(row.relations as unknown as ProcurementRelation[]),
        );
      } else if (row.role) {
        prior.relations.push({
          kind: row.role as ProcurementRelation["kind"],
        });
      }
      byMp.set(mpId, prior);
    }
    return [...byMp.values()];
  }, [data]);

  return { entries, isLoading: !!eik && isLoading };
};
