// Per-resolution conflict-of-interest flags from
// data/officials/derived/councillor_conflicts.json — written by
// scripts/officials/build_councillor_conflicts.ts.
//
// The hook returns a Map<resolutionId, ConflictFlag[]> for the current
// município, so the votes tile can decorate each councillor avatar with a
// warning ring when that councillor has a declared / TR-derived stake in
// a company named in the resolution they voted on.
//
// Coverage today is **zero** — the resolution titles we currently ship
// describe topics (zoning, education, finance) not vendor names. Real
// conflicts get reported in resolution bodies, which the council ingest
// doesn't currently lift. Wiring the hook anyway means a future ingest
// extension (or a switch to body-scanning) will light flags up across the
// site with no frontend change.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export type CouncillorConflictFlag = {
  slug: string;
  name: string;
  companyName: string;
  uic: string | null;
  trRole: string | null;
  vote: "for" | "against" | "abstain";
};

type ConflictsFile = {
  generatedAt: string;
  byObshtina: Record<
    string,
    {
      byResolution: Record<string, { flags: CouncillorConflictFlag[] }>;
    }
  >;
};

const fetchConflicts = async (): Promise<ConflictsFile | undefined> => {
  const r = await fetch(
    dataUrl("/officials/derived/councillor_conflicts.json"),
  );
  if (r.status === 404) return undefined;
  if (!r.ok) throw new Error(`councillor conflicts fetch failed: ${r.status}`);
  if (!(r.headers.get("content-type") ?? "").includes("json")) return undefined;
  return r.json();
};

const EMPTY = new Map<string, CouncillorConflictFlag[]>();

export const useCouncillorConflicts = (
  obshtina: string | null | undefined,
): Map<string, CouncillorConflictFlag[]> => {
  const { data } = useQuery({
    queryKey: ["councillor_conflicts"] as const,
    queryFn: fetchConflicts,
    staleTime: Infinity,
  });

  return useMemo(() => {
    if (!obshtina || !data) return EMPTY;
    const slice = data.byObshtina[obshtina];
    if (!slice) return EMPTY;
    const map = new Map<string, CouncillorConflictFlag[]>();
    for (const [rid, info] of Object.entries(slice.byResolution)) {
      map.set(rid, info.flags);
    }
    return map;
  }, [data, obshtina]);
};
