// Per-EIK officials-connection lookup — the non-MP sibling of
// useProcurementMpConnectedByEik, sharing the same /api/db/company-politicians
// query. The corpus-wide EIK set (for the risk scorer's O(1) pepConnected
// flag) comes from the shared risk-indexes payload instead of a manifest file.

import { useMemo } from "react";
import { useRiskIndexes } from "./useRiskIndexes";
import { useCompanyPoliticians } from "./useMpConnectedByEik";

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
