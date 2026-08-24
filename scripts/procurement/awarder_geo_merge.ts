// The merge half of awarder_geo_map.ts, kept separate so it stays pure — no
// filesystem, no network, no argv — and can therefore be tested directly. The
// builder itself is I/O from end to end; every decision that the incident below
// depends on lives here instead.
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
//
// It has since become the home for every PURE rule in this family, because
// purity is the property that makes them testable at all — the builder, the
// gate and the CLI that consume them are I/O from end to end. Three now live
// here, and they are about three different hops and three different incidents:
// `mergeGeoOverrides` (the map itself, the 2026-08-10 tier-blocked shrink),
// `tierAgeDays` (how long a dark tier may ride, the 2026-08 Tier B outage), and
// `compareSeatsToMap` (whether the map was ever PUBLISHED, 2026-08-24).

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

// THE availability relation, stated once: which source labels each tier is a
// prerequisite for. `mon+oblast` appears under two tiers on purpose — it needs
// both — and `producibleSources` below is derived from this table rather than
// restating it, so the operator note and the merge decision can never disagree
// about what a down tier costs.
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

// TIER_LABELS inverted: label → every tier that must be up to produce it.
const GATED_BY = ((): Map<string, string[]> => {
  const m = new Map<string, string[]>();
  for (const [tier, labels] of Object.entries(TIER_LABELS))
    for (const l of labels) m.set(l, [...(m.get(l) ?? []), tier]);
  return m;
})();

// Tier A is a parse of the awarder's own name, so it runs whenever the builder
// does; it has no entry in TierInputs because it can never be unavailable.
const tierUp = (tier: string, t: TierInputs): boolean =>
  tier === "name" ? true : t[tier as keyof TierInputs];

/** Which source labels this run was capable of producing — a label needs EVERY
 *  tier that gates it. Derived from TIER_LABELS so the two cannot drift. */
export const producibleSources = (t: TierInputs): Set<string> =>
  new Set(
    [...GATED_BY]
      .filter(([, tiers]) => tiers.every((tier) => tierUp(tier, t)))
      .map(([label]) => label),
  );

export interface MergeReport {
  /** Carried over from the committed map, by source label. */
  carried: Record<string, number>;
  /** Prior entries whose awarder is still in the corpus but no longer an
   *  override candidate — it gained a real OCDS address, so the override is
   *  superseded. A normal data improvement. */
  retired: number;
  /** Prior entries whose awarder is not in the awarders dir at all. NOT a data
   *  improvement — the usual cause is a half-rebuilt dir, which is one of the
   *  shapes the shrink guard exists to catch, so it is counted apart from
   *  `retired` rather than reported as one. */
  vanished: number;
  /** Prior entries whose tier DID run, was offered this awarder, and no longer
   *  resolves it. The one shape that is allowed to shrink the map. */
  unresolved: number;
  /** Prior entries with no `ekatte`. Counted so that every prior entry missing
   *  from the output is accounted for by exactly one counter — otherwise the
   *  guard's message stops reconciling with the map size it quotes. */
  malformed: number;
  /** Fresh entries that replaced a prior one with a different EKATTE. */
  changed: number;
  /** Prior source labels this build does not know about (a renamed tier). Their
   *  entries are carried over unless a recognised tier resolved the same awarder
   *  this run — an unknown label ranks last, so a live tier's answer wins. */
  unknownSources: string[];
}

/**
 * Fold the committed map into the freshly-built one.
 *
 * @param prior        the committed `awarders` block (empty on a first build)
 * @param fresh        what this run resolved
 * @param producible   source labels this run could have produced
 * @param candidateEiks awarders that were actually OFFERED to the tiers this
 *                      run — i.e. present in the dir and still without an OCDS
 *                      address. An eik outside this set was never asked, so
 *                      "the tier no longer resolves it" cannot be concluded
 *                      from its absence.
 * @param knownEiks    every awarder in the dir, addressed or not. Only used to
 *                      tell `retired` from `vanished`; omit and a dropped
 *                      non-candidate is counted as `retired`.
 */
export const mergeGeoOverrides = (
  prior: Record<string, GeoEntry>,
  fresh: Record<string, GeoEntry>,
  producible: Set<string>,
  candidateEiks: Set<string>,
  knownEiks?: Set<string>,
): { awarders: Record<string, GeoEntry>; report: MergeReport } => {
  const awarders: Record<string, GeoEntry> = { ...fresh };
  const report: MergeReport = {
    carried: {},
    retired: 0,
    vanished: 0,
    unresolved: 0,
    malformed: 0,
    changed: 0,
    unknownSources: [],
  };
  const unknown = new Set<string>();
  const carry = (e: GeoEntry): void => {
    report.carried[e.source] = (report.carried[e.source] ?? 0) + 1;
  };

  for (const [eik, p] of Object.entries(prior)) {
    if (!p?.ekatte) {
      report.malformed += 1;
      continue;
    }
    if (SOURCE_RANK[p.source] === undefined) unknown.add(p.source);
    // The tier could not have produced this label this run.
    const stale = !producible.has(p.source);
    const f = fresh[eik];

    // Superseded: the awarder now carries a real address, so it was never
    // offered to any tier and the override no longer has a job. Dropping it is
    // correct even while its tier is down.
    if (!candidateEiks.has(eik)) {
      if (!f) {
        if (knownEiks && !knownEiks.has(eik)) report.vanished += 1;
        else report.retired += 1;
      }
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
    // real improvement is not something to suppress. The comparison is `<=`
    // rather than `<` because `mon`/`mon+oblast` and `name`/`name+oblast`
    // deliberately share a rank: an oblast-pinned entry whose pin can no longer
    // be derived outranks the bare re-resolve that replaced it.
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

// Tighter than the 25% ratios elsewhere in the repo on purpose: the incident
// that motivated all of this was 93/2164 = 4.3%, and a 25% guard is
// arithmetically incapable of seeing it.
export const SHRINK_TOLERANCE = 0.05;

/** What `compareSeatsToMap` found. The two arms are reported separately because
 *  they have different causes: `missing` is "the loader never ran, or ran against
 *  a half-built awarders dir"; `disagreeing` is "one side moved and the other did
 *  not". Lumping them into a count loses that. */
export interface SeatsDrift {
  /** Map ЕИК with no `awarder_seats` row at all. */
  missing: string[];
  /** Present on both sides, different EKATTE. */
  disagreeing: { eik: string; map: string; seats: string }[];
  /** Map entries actually examined — every entry carrying an `ekatte`.
   *  Malformed entries are SKIPPED (see `compareSeatsToMap`), so this is
   *  `Object.keys(map).length` MINUS them, not equal to it.
   *
   *  ⚠ A consumer must assert a FLOOR (`checked > 2_000`), never
   *  `checked === Object.keys(map).length`. That equality is `0 === 0` on an
   *  empty or unparseable map — the one vacuity vector this field exists for,
   *  since an empty SEATS table is loud (every entry lands in `missing`) while
   *  an empty MAP is silent (both arms come back clean). It also breaks the
   *  first time a malformed entry appears, blaming the loader for a defect in
   *  the file. The vacuity fixture is in awarder_geo_merge.test.ts. */
  checked: number;
}

/**
 * Does the served `awarder_seats` table still agree with the committed override
 * map about where each address-less buyer sits?
 *
 * WHY THIS EXISTS. The map reaches the site through three hops and only the
 * first two are gated: `awarder_geo_map.ts` writes the committed JSON (gated by
 * awarder_geo_overrides.test.ts), `buildRollups` bakes it fill-missing into the
 * gitignored awarder rollups, and `db:load:awarder-seats:pg[:cloud]` publishes
 * those to Postgres. A map rebuilt and never published is therefore invisible —
 * every existing gate passes, row counts reconcile, and the site keeps serving
 * the previous placements at a 200. Measured 2026-08-24: prod kept ЕИК
 * 106633686 in Дърманци for hours after the map said Мездра.
 * Plan: docs/plans/awarder-seats-freshness-gate-v1.md.
 *
 * It is an EQUALITY check, not a statistical one. Measured on a freshly
 * published corpus, all 2,174 map entries have a seats row and all 2,174 agree —
 * so a single disagreement is a real defect, and that stale prod state would
 * have surfaced as exactly one.
 *
 * @param map    the committed `awarders` block
 * @param seats  eik → ekatte, restricted to eiks the map names. Rows outside the
 *               map are address-derived, curated or name-parsed buyers the map
 *               never speaks for (the override is applied FILL-MISSING), so
 *               passing them in would be harmless but pointless. The value is
 *               `string | null` because `awarder_seats.ekatte` is NULLable
 *               (021) and the loader writes `?? null` — a published-but-unplaced
 *               row is reported as `missing`, not as a disagreement reading
 *               „seats: null", because `missing`'s remedy (re-run the loader) is
 *               the one that matches. 0 of 3,881 rows are NULL today, so this is
 *               latent rather than live.
 *
 * ⚠ A caller cannot narrow this to "override-derived rows only" using
 * `awarder_seats` columns. `source` is the SEATS loader's own provenance
 * (geo/name/curated) and `tier` is the buyer TYPE (school/hospital/…); every map
 * ЕИК lands under `source = 'geo'`, indistinguishable from the ~1,657
 * address-derived rows that share it.
 */
export const compareSeatsToMap = (
  map: Record<string, GeoEntry>,
  seats: Map<string, string | null>,
): SeatsDrift => {
  const drift: SeatsDrift = { missing: [], disagreeing: [], checked: 0 };
  for (const [eik, entry] of Object.entries(map)) {
    // A map entry with no ekatte is malformed rather than undeployed, and
    // awarder_geo_overrides.test.ts already fails on it. Skipping it here keeps
    // this function's two arms about publication only, and keeps `checked`
    // honest about what was actually compared.
    if (!entry?.ekatte) continue;
    drift.checked += 1;
    const seat = seats.get(eik);
    // `== null` covers both absent and published-with-no-placement.
    if (seat == null) drift.missing.push(eik);
    else if (seat !== entry.ekatte)
      drift.disagreeing.push({ eik, map: entry.ekatte, seats: seat });
  }
  // Both arms sorted, and by the SAME comparator. The order is load-bearing:
  // JS enumerates index-like ЕИК numerically before the rest, so an unsorted
  // walk starts at `101005300` rather than `000000210` and the failure message
  // reshuffles between runs for no reason. Plain `<`/`>` rather than
  // `localeCompare`, which reads the runtime's default locale — an environment
  // input this function otherwise has none of.
  const byEik = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  drift.missing.sort(byEik);
  drift.disagreeing.sort((a, b) => byEik(a.eik, b.eik));
  return drift;
};

/**
 * Age, in days, of a tier's last FRESH resolution — the input to the staleness
 * ratchet in `awarder_geo_overrides.test.ts`.
 *
 * Lives here, beside `shrinkVerdict`, for the reason this module exists at all:
 * it is pure, so it can be tested directly. The gate that consumes it can only
 * read the committed artifact from a hard-coded path, so without this split the
 * only way to exercise the ratchet's branches is to MUTATE a git-tracked file —
 * unsafe in a repo where another process commits to `main`.
 *
 * `now` is a parameter rather than a `Date.now()` call so the unit tests need no
 * fake timers; the caller supplies the real clock, and only the caller is the
 * sanctioned wall-clock reader (see docs/testing-standards.md §Determinism).
 *
 * An absent or unparseable stamp yields NaN, which fails every `<` comparison —
 * the safe direction, and deliberately not 0 or Infinity.
 */
export const tierAgeDays = (
  lastFreshAt: string | undefined,
  now: number,
): number => (now - Date.parse(lastFreshAt ?? "")) / 86_400_000;

/**
 * Should the run refuse to write? The merge makes an unavailable tier
 * non-shrinking by construction, so this is a BACKSTOP for the shapes it cannot
 * model — a resolver regression that drops entries across several live tiers,
 * or a half-rebuilt awarders dir.
 *
 * It measures GROSS loss of prior entries, never the net map size. Net would
 * let growth mask loss: the candidate pool grows every ingest (2,753 → 2,758
 * between two committed builds), so a run that resolves N new awarders and
 * drops N old ones reads as flat. Gross also makes the operator's message
 * reconcile — every prior entry missing from the output is in exactly one of
 * these four counters.
 */
export const shrinkVerdict = (
  priorCount: number,
  report: MergeReport,
  tolerance: number = SHRINK_TOLERANCE,
): { refuse: boolean; lost: number; pct: number } => {
  const lost =
    report.retired + report.vanished + report.unresolved + report.malformed;
  const pct = priorCount ? lost / priorCount : 0;
  return { refuse: priorCount > 0 && pct > tolerance, lost, pct };
};
