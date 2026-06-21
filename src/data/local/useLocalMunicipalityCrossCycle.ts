// Per-município cross-cycle council trends. Reuses useLocalMunicipalityHistory
// (one bundle per regular cycle for this município) and reshapes each cycle's
// `council` party-by-party totals into the shared `CrossCycleData` so the same
// chart that powers the national trend tile renders a place-scoped version.
//
// Party metadata (display name + colour) is resolved through useCanonicalParties
// rather than carried on the row: the bundle's council rows hold only a
// primaryCanonicalId + the raw localPartyName. Buckets fold via `bucketId`
// (shared with the national hook) so a lineage stays one line across cycles
// even when older cycles left the canonical unresolved.

import { useMemo } from "react";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useLocalMunicipalityHistory } from "./useLocalMunicipalityHistory";
import { UNRESOLVED_PARTY_COLOR } from "./cycleDate";
import {
  CrossCycleData,
  CrossCycleParty,
  bucketId,
  yearOf,
} from "./crossCycleShape";

export const useLocalMunicipalityCrossCycle = (
  obshtinaCode?: string | null,
  topN = 6,
): { data?: CrossCycleData; isLoading: boolean } => {
  const { rows, isLoading } = useLocalMunicipalityHistory(obshtinaCode);
  const { colorFor, displayNameForId } = useCanonicalParties();

  const data = useMemo<CrossCycleData | undefined>(() => {
    const cyclesAsc = rows.map((r) => ({
      cycle: r.cycle,
      year: yearOf(r.round1Date),
    }));

    // id → per-cycle council pct + display fallbacks. displayName/color are
    // resolved from the canonical id when known; otherwise we keep the first
    // local-party name seen (purely-local slates have no canonical entry).
    type Acc = {
      displayName: string;
      color: string;
      council: Map<string, number>;
      votes: Map<string, number>;
    };
    const byId = new Map<string, Acc>();

    // A cycle contributes only when this município's council carries real
    // vote signal — older HTML-only ingests (e.g. some 2011/2015 bundles)
    // ship 0-vote council rows that would otherwise drag every line to 0.
    const hasCouncilSignal = (
      council: NonNullable<(typeof rows)[number]["bundle"]>["council"],
    ): boolean => council.some((p) => p.pctOfValid > 0 || p.totalVotes > 0);

    let usableCycles = 0;
    for (const r of rows) {
      if (!r.bundle || !hasCouncilSignal(r.bundle.council)) continue;
      usableCycles++;
      for (const p of r.bundle.council) {
        const id = bucketId(p.primaryCanonicalId, p.localPartyName);
        let a = byId.get(id);
        if (!a) {
          const canonName = displayNameForId(id);
          a = {
            displayName: canonName ?? p.localPartyName,
            color: colorFor(id) ?? UNRESOLVED_PARTY_COLOR,
            council: new Map(),
            votes: new Map(),
          };
          byId.set(id, a);
        }
        // Sum in case two local rows fold into the same canonical bucket.
        a.council.set(r.cycle, (a.council.get(r.cycle) ?? 0) + p.pctOfValid);
        a.votes.set(r.cycle, (a.votes.get(r.cycle) ?? 0) + p.totalVotes);
      }
    }

    if (usableCycles < 2 || byId.size === 0) return undefined;

    const latestCycle = [...rows]
      .reverse()
      .find((r) => r.bundle && hasCouncilSignal(r.bundle.council))?.cycle;

    const parties: CrossCycleParty[] = Array.from(byId.entries()).map(
      ([canonicalId, a]) => ({
        canonicalId,
        displayName: a.displayName,
        color: a.color,
        latestCouncilPct: (latestCycle && a.council.get(latestCycle)) || 0,
        points: cyclesAsc.map((c) => ({
          cycle: c.cycle,
          year: c.year,
          councilPct: a.council.has(c.cycle)
            ? (a.council.get(c.cycle) ?? null)
            : null,
          mayors: null,
          votes: a.votes.get(c.cycle) ?? null,
        })),
      }),
    );

    // Rank by latest council share, then by peak so a party that has since
    // faded (a once-dominant local coalition) can still make the cut.
    parties.sort((x, y) => {
      if (y.latestCouncilPct !== x.latestCouncilPct)
        return y.latestCouncilPct - x.latestCouncilPct;
      const peak = (p: CrossCycleParty) =>
        Math.max(0, ...p.points.map((pt) => pt.councilPct ?? 0));
      return peak(y) - peak(x);
    });

    return { cyclesAsc, parties: parties.slice(0, topN) };
    // colorFor / displayNameForId are stable closures from the parties hook;
    // the meaningful inputs are the fetched rows + topN.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, topN]);

  return { data, isLoading };
};
