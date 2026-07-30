// Per-EIK officials-connection lookup — the non-MP sibling of
// useProcurementMpConnectedByEik, sharing the same /api/db/company-politicians
// query. The corpus-wide EIK set (for the risk scorer's O(1) pepConnected
// flag) comes from the shared risk-indexes payload instead of a manifest file.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRiskIndexes } from "./useRiskIndexes";
import { useCompanyPoliticians } from "./useMpConnectedByEik";
import type { NgoForeignFundedEntry } from "./computeProcurementRisk";

/** Chip-grade official entry: who, route slug, and their public role. */
export type PepConnectedChipEntry = {
  slug: string;
  name: string;
  role: string;
  relations: Array<{ role: string }>;
};

/** The full set of contractor EIKs tied to a non-MP official. Used by the
 *  risk scorer to flag pepConnected in O(1). */
export const usePepConnectedEikSet = (): {
  set: Set<string>;
  isLoading: boolean;
  isLoaded: boolean;
} => {
  const { data, isLoading } = useRiskIndexes();
  const set = useMemo(() => new Set(data?.pepConnectedEiks ?? []), [data]);
  // isLoaded gates on the payload actually loading (data != null) — a missing
  // payload must leave pepConnected UNAVAILABLE in the risk scorer, not
  // "available + never fires" (which would dilute every CRI).
  return { set, isLoading, isLoaded: data != null };
};

type NgoForeignRow = NgoForeignFundedEntry & { eik: string };

const fetchNgoForeign = async (): Promise<NgoForeignRow[]> => {
  const r = await fetch("/api/db/procurement-ngo-foreign");
  if (!r.ok) return [];
  const j = (await r.json()) as { entries?: NgoForeignRow[] };
  return j.entries ?? [];
};

/** Contractor EIK → foreign-funded-NGO disclosure. Backs the neutral
 *  `ngoForeignFunded` flag on the contract screens (see NgoForeignFundedEntry).
 *
 *  Its OWN route (~35 rows / 6.3 kB) rather than a slice of the 1.29 MB
 *  risk-indexes payload: this is the one chip input the contract_risk_cache masks
 *  cannot carry — it is a neutral disclosure with no scored bit — so it would
 *  otherwise be the last reason those screens still downloaded the whole corpus
 *  index. */
export const useNgoForeignFundedByEik = (): {
  byEik: Map<string, NgoForeignFundedEntry>;
  isLoading: boolean;
  isLoaded: boolean;
} => {
  const { data, isLoading } = useQuery({
    queryKey: ["db", "procurement-ngo-foreign"] as const,
    queryFn: fetchNgoForeign,
    staleTime: Infinity,
    retry: false,
  });
  const byEik = useMemo(() => {
    const m = new Map<string, NgoForeignFundedEntry>();
    for (const r of data ?? [])
      m.set(r.eik, {
        kind: r.kind,
        ngoName: r.ngoName,
        ngoEik: r.ngoEik,
        funder: r.funder,
        eur: r.eur,
        person: r.person,
      });
    return m;
  }, [data]);
  return { byEik, isLoading, isLoaded: data != null };
};

export const usePepConnectedByEik = (
  eik?: string | null,
): { entries: PepConnectedChipEntry[]; isLoading: boolean } => {
  const { data, isLoading } = useCompanyPoliticians(eik);

  const entries = useMemo<PepConnectedChipEntry[]>(() => {
    const bySlug = new Map<string, PepConnectedChipEntry>();
    for (const row of data ?? []) {
      if (row.kind !== "official") continue;
      const m = /^\/officials\/(.+)$/.exec(row.ref);
      if (!m) continue;
      const prior = bySlug.get(m[1]) ?? {
        slug: m[1],
        name: row.politician,
        role: row.role ?? "",
        relations: [],
      };
      // Official rows' relations jsonb carries the pep shape ({role, …}) —
      // surface the company-relation roles next to the official's own role.
      for (const r of row.relations ?? []) {
        const role = typeof r.role === "string" ? r.role : null;
        if (role && !prior.relations.some((x) => x.role === role))
          prior.relations.push({ role });
      }
      bySlug.set(m[1], prior);
    }
    return [...bySlug.values()];
  }, [data]);

  return { entries, isLoading: !!eik && isLoading };
};
