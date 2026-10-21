import type { LocalProblemSectionsReport } from "@/data/local/useLocalProblemSections";

type Bucket = {
  votes: number;
  name: string;
  color: string;
  canonicalId: string | null;
};

// Sum the pre-aggregated party totals across the município's flagged
// neighborhoods (a município can hold several — e.g. Burgas has Pobeda + the
// two Ezerovo mahali), keyed by a stable bucket id: the canonical party id when
// known, else `local:<num>` for a local-only slate (OIK-scoped, so it never
// aligns across cycles).
const inScope = (
  report: LocalProblemSectionsReport | undefined,
  obshtinaCode: string,
  rayonCode?: string,
) =>
  (report?.neighborhoods ?? []).filter(
    (n) =>
      n.obshtinaCode === obshtinaCode &&
      (!rayonCode || n.rayonCode === rayonCode),
  );

const aggregate = (
  report: LocalProblemSectionsReport | undefined,
  obshtinaCode: string,
  rayonCode?: string,
  onlyIds?: Set<string>,
): { totals: Map<string, Bucket>; total: number } => {
  const totals = new Map<string, Bucket>();
  let total = 0;
  for (const n of inScope(report, obshtinaCode, rayonCode)) {
    if (onlyIds && !onlyIds.has(n.id)) continue;
    for (const p of n.parties) {
      const canonicalId = p.primaryCanonicalId ?? null;
      const key = canonicalId ?? `local:${p.localPartyNum}`;
      const cur = totals.get(key) ?? {
        votes: 0,
        name: p.localPartyName,
        color: p.color,
        canonicalId,
      };
      cur.votes += p.votes;
      totals.set(key, cur);
      total += p.votes;
    }
  }
  return { totals, total };
};

export type ProblemPartyRow = {
  key: string;
  canonicalId: string | null;
  rawName: string;
  color: string;
  votes: number;
  share: number;
  deltaPP?: number;
};

// The rows the tile renders. Votes and shares cover every flagged neighbourhood the CURRENT
// cycle has; ΔPP is computed only over the neighbourhoods BOTH cycles have, on both sides.
// Otherwise a neighbourhood present in one cycle only moves the change column on its own —
// Burgas 2015 gained Долно Езерово (cited section codes, 2026-10-21) while 2011 cannot place
// it, so a whole-município ΔPP would partly measure six added sections, not a shift in how
// the same places voted.
export const buildProblemPartyRows = (
  current: LocalProblemSectionsReport | undefined,
  prior: LocalProblemSectionsReport | undefined,
  obshtinaCode: string,
  rayonCode?: string,
): ProblemPartyRow[] => {
  const { totals, total } = aggregate(current, obshtinaCode, rayonCode);
  if (!total) return [];
  const priorIds = new Set(
    inScope(prior, obshtinaCode, rayonCode).map((n) => n.id),
  );
  const common = new Set(
    inScope(current, obshtinaCode, rayonCode)
      .map((n) => n.id)
      .filter((id) => priorIds.has(id)),
  );
  const { totals: curCommon, total: curCommonTotal } = aggregate(
    current,
    obshtinaCode,
    rayonCode,
    common,
  );
  const { totals: priorTotals, total: priorTotal } = aggregate(
    prior,
    obshtinaCode,
    rayonCode,
    common,
  );

  const built = Array.from(totals.entries()).map(([key, b]) => {
    const share = (100 * b.votes) / total;
    let deltaPP: number | undefined;
    // Only canonical buckets are comparable across cycles — a local-only
    // slate's ballot number is reassigned each cycle.
    if (b.canonicalId && priorTotal && curCommonTotal) {
      const pb = priorTotals.get(b.canonicalId);
      const cb = curCommon.get(b.canonicalId);
      if (pb && cb)
        deltaPP =
          (100 * cb.votes) / curCommonTotal - (100 * pb.votes) / priorTotal;
    }
    return {
      key,
      canonicalId: b.canonicalId,
      // Fallback name (raw local slate name); the canonical display name is
      // resolved in render so the memo stays stable.
      rawName: b.name,
      color: b.color,
      votes: b.votes,
      share,
      deltaPP,
    };
  });

  built.sort((a, b) => b.votes - a.votes);
  return built.filter((r) => r.votes > 0).slice(0, 8);
};
