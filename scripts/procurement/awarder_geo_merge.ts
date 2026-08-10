// The merge half of awarder_geo_map.ts, kept separate so it is pure and
// testable (the builder module runs `main()` on import).
//
// WHY THIS EXISTS. `awarder_geo_map.ts` resolves an awarder's EKATTE through
// several independent tiers and writes whatever it resolved THIS run. Every
// tier is optional and degrades to zero entries when its input is unreachable —
// a missing derived file, an absent TR mirror, or (measured 2026-08-10) a
// data.egov.bg 403 that blocks the МОН register from this host's egress IP.
// A tier contributing nothing therefore SHRANK the committed map: the run
// printed a one-line "Tier B skipped", exited 0, and 93 awarders silently left
// `by_settlement` and the place / My-Area tiles. Nothing failed.
//
// The fix is the one the repo already applies to `interreg_fetch.ts`: a source
// we could not read is not a source that says "nothing". Here the case for
// carrying over is stronger still, because ЕИК↔EKATTE is stable — an institution
// does not move — so an entry a tier resolved last week is still correct today
// even while that tier is unreachable.
//
// The rule, in one sentence: keep a prior entry when the tier that produced it
// could NOT run this time; drop it only when that tier ran and no longer
// resolves the awarder.

export interface GeoEntry {
  ekatte: string;
  source: string;
  confidence: string;
}

// The inputs a tier needs, by the key used in the output's `tiers` block. Each
// is independently reachable-or-not, and `name` is pure local computation over
// the awarder's own name, so it can never be unavailable.
export interface TierInputs {
  ri: boolean;
  tr: boolean;
  school: boolean;
  ocds: boolean;
  mon: boolean;
  /** Tier D, the buyer→oblast hint. Produces no entries of its own but IS the
   *  difference between `mon`/`mon+oblast` and `name`/`name+oblast`, so losing
   *  it shrinks the map exactly like losing a resolving tier. */
  oblast: boolean;
}

export const TIER_KEYS: (keyof TierInputs | "name")[] = [
  "ri",
  "tr",
  "school",
  "ocds",
  "mon",
  "oblast",
  "name",
];

// Which source labels each tier is a prerequisite for — the inverse of
// producibleSources(), used to attribute carried-over entries to the tier that
// was down. `mon+oblast` appears twice on purpose: it needs both.
export const TIER_LABELS: Record<string, string[]> = {
  ri: ["ri"],
  tr: ["tr"],
  school: ["school"],
  ocds: ["ocds"],
  mon: ["mon", "mon+oblast"],
  oblast: ["mon+oblast", "name+oblast"],
  name: ["name", "name+oblast"],
};

// Tier priority, lower = more authoritative, in the order main() tries them.
// Keyed by the SOURCE LABEL stored in the map rather than by tier, because two
// labels can share a tier (`mon` / `mon+oblast`) while differing in what they
// needed to be produced.
export const SOURCE_RANK: Record<string, number> = {
  ri: 0,
  tr: 1,
  school: 2,
  ocds: 3,
  mon: 4,
  "mon+oblast": 4,
  name: 5,
  "name+oblast": 5,
};

const rankOf = (source: string): number =>
  SOURCE_RANK[source] ?? Number.POSITIVE_INFINITY;

// Which source labels this run was capable of producing. A `+oblast` label needs
// BOTH its resolving tier and the Tier-D hint, which is why availability is
// computed per LABEL and not per tier.
export const producibleSources = (t: TierInputs): Set<string> => {
  const out = new Set<string>();
  if (t.ri) out.add("ri");
  if (t.tr) out.add("tr");
  if (t.school) out.add("school");
  if (t.ocds) out.add("ocds");
  if (t.mon) out.add("mon");
  if (t.mon && t.oblast) out.add("mon+oblast");
  // Tier A is local; it always runs.
  out.add("name");
  if (t.oblast) out.add("name+oblast");
  return out;
};

export interface MergeReport {
  /** Carried over from the committed map, by source label. */
  carried: Record<string, number>;
  /** Prior entries whose awarder is no longer an override candidate at all —
   *  it gained a real OCDS address, so the override is superseded. */
  retired: number;
  /** Prior entries whose tier DID run, was offered this awarder, and no longer
   *  resolves it. The one shape that is allowed to shrink the map. */
  unresolved: number;
  /** Fresh entries that replaced a prior one with a different EKATTE. */
  changed: number;
  /** Prior source labels this build does not know about (a renamed tier). Their
   *  entries are carried over — we cannot verify a tier we cannot name. */
  unknownSources: string[];
}

/**
 * Fold the committed map into the freshly-built one.
 *
 * @param prior        the committed `awarders` block (empty on a first build)
 * @param fresh        what this run resolved
 * @param producible   source labels this run could have produced
 * @param candidateEiks awarders that were actually OFFERED to the tiers this
 *                      run — i.e. still have no OCDS address. An eik outside
 *                      this set was never asked, so "the tier no longer
 *                      resolves it" cannot be concluded from its absence.
 */
export const mergeGeoOverrides = (
  prior: Record<string, GeoEntry>,
  fresh: Record<string, GeoEntry>,
  producible: Set<string>,
  candidateEiks: Set<string>,
): { awarders: Record<string, GeoEntry>; report: MergeReport } => {
  const awarders: Record<string, GeoEntry> = { ...fresh };
  const report: MergeReport = {
    carried: {},
    retired: 0,
    unresolved: 0,
    changed: 0,
    unknownSources: [],
  };
  const unknown = new Set<string>();
  const carry = (e: GeoEntry): void => {
    report.carried[e.source] = (report.carried[e.source] ?? 0) + 1;
  };

  for (const [eik, p] of Object.entries(prior)) {
    if (!p?.ekatte) continue;
    if (SOURCE_RANK[p.source] === undefined) unknown.add(p.source);
    // The tier could not have produced this label this run.
    const stale = !producible.has(p.source);
    const f = fresh[eik];

    // Superseded: the awarder now carries a real address, so it was never
    // offered to any tier and the override no longer has a job. Dropping it is
    // correct even while its tier is down.
    if (!candidateEiks.has(eik)) {
      if (!f) report.retired += 1;
      continue;
    }

    if (!f) {
      if (stale) {
        awarders[eik] = p;
        carry(p);
      } else {
        report.unresolved += 1;
      }
      continue;
    }

    // Both present. A prior entry from an unavailable tier wins only when that
    // tier is at least as authoritative as the one that answered this time —
    // otherwise the fresh, lower-tier answer is a genuine re-resolution and a
    // real improvement is not something to suppress.
    if (stale && rankOf(p.source) <= rankOf(f.source)) {
      awarders[eik] = p;
      carry(p);
    } else if (p.ekatte !== f.ekatte) {
      report.changed += 1;
    }
  }
  report.unknownSources = [...unknown].sort();
  return { awarders, report };
};

/** Entry counts by source label, recomputed from whatever was actually written
 *  — a merged map's `sources` block must describe the map, not the run. */
export const countSources = (
  awarders: Record<string, GeoEntry>,
): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const e of Object.values(awarders))
    out[e.source] = (out[e.source] ?? 0) + 1;
  return out;
};
