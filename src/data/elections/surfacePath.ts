// WHERE a result surface lives, and what it may weigh (§5.0, §"Artifact paths", §"Size and
// fetch budgets" of docs/plans/elections-hub-implementation-v1.md).
//
// ⚠ ONE DEFINITION, TWO RUNTIMES. The Node generator writes these paths and the browser hook
// reads them, so they are declared here once and imported by both. A generator with its own
// copy of the path template is the failure this module exists to prevent: it writes a file the
// runtime never asks for, both halves pass their own tests, and the page falls back to the
// legacy composition for ever — at a 200, with nothing red.
//
// ⚠ A LEVEL EITHER EMITS AN ARTIFACT OR IT DOES NOT, and that is a MEASUREMENT, not a
// preference. §5.0's rule: a surface is emitted only where the canonical shard cannot already
// serve the first screen inside the budget. Where it can, the shell reads the canonical file
// through this same indirection and a thin adapter, so the runtime contract is identical and
// the reader pays one fetch either way. `scripts/elections/surface_budget.ts` re-measures the
// table and `surface_budget.test.ts` fails when a decision here stops matching the corpus.

import type { ElectionKind, ElectionPlaceLevel } from "./surfaceTypes";

/** Uncompressed JSON ceilings, in BYTES. §"Size and fetch budgets".
 *
 *  ⚠ WHAT THE BUDGET APPLIES TO DEPENDS ON THE POLICY, and conflating the three is a category
 *  error that produces a wrong decision in BOTH directions:
 *
 *    artifact  — the generated file. It is a projection, so the budget is a real ceiling on it.
 *    canonical — the existing shard, because that IS what the reader downloads for the first
 *                screen. This is the strict case, and it is what caught parliamentary/settlement.
 *    embedded  — the shard too, for exactly the reason `canonical` is judged on it: the reader
 *                downloads the same bytes either way. An `embedded` level that is over budget
 *                is OVER BUDGET, and stays so until a `budgetWaiver` says why it is accepted.
 *
 *  ⚠ THERE IS NO "THE BUDGET APPLIES TO THE KEY, NOT THE HOST" ESCAPE, and this comment used to
 *  claim one. It is unfalsifiable — nothing measures a key that has not been generated yet — and
 *  it made `local/section` look compliant when it is 1.26x over. The honest instrument is a
 *  declared waiver carrying the arithmetic that made the overage the better trade. */
export const SURFACE_BUDGET_BYTES = {
  country: 24 * 1024,
  region: 16 * 1024,
  abroad: 16 * 1024,
  municipality: 16 * 1024,
  settlement: 16 * 1024,
  section: 8 * 1024,
} as const satisfies Record<ElectionPlaceLevel, number>;

/** How a level's first screen is served.
 *
 *  `artifact`  a generated surface at `surfacePathFor(...)`.
 *  `canonical` the existing shard, read directly and adapted — no second file, no second fetch.
 *  `embedded`  the canonical shard carries a `surface` KEY. Distinct from `canonical` because
 *              the generator still writes something (it rewrites that file), while the reader
 *              still fetches exactly one file. Conflating the two loses the generator's job. */
export type SurfaceSource =
  | "artifact"
  | "canonical"
  | "embedded"
  /** The kind x level does not exist — local elections are not held abroad. Distinct from
   *  `canonical`, which promises a shard a reader can be sent to; this promises nothing, and
   *  giving it its own member is what lets the coverage gate read the policy instead of
   *  carrying a hand-written carve-out for the one row that lies. */
  | "none";

/** Why a level is served the way it is — the measurement, in the record, beside the decision.
 *
 *  ⚠ `measuredMaxBytes` IS A DATED OBSERVATION, NOT A CONSTRAINT. It is what the corpus showed on
 *  `measuredOn`; the budget is the constraint. Kept because "no — inside budget" is unreadable
 *  without the number that made it true, and because a corpus that grows past a `canonical`
 *  decision must flip it rather than quietly serve an over-budget first screen. */
export type BudgetWaiver = {
  /** Bucket objects a flip to `artifact` would add. §5.0: the object count is the dominant cost. */
  objectCost: number;
  /** How far over budget the worst place is, as a multiple. 1.26 is not 77. */
  worstCaseOverBy: number;
  /** Bytes a flip would save on that worst place. */
  bytesSaved: number;
  note: string;
};

export type SurfaceLevelPolicy = {
  source: SurfaceSource;
  /** The canonical file this level's first screen comes from, for `canonical` / `embedded`. */
  canonicalNote: string;
  /** ⚠ THE LARGEST place at this level, never the mean. The mean is what made the plan's own
   *  table mark parliamentary/settlement "inside budget" at 7.5 KB while Пловдив was 1,235 KB.
   *  Named for the statistic so the wrong one cannot be pasted in silently. */
  measuredMaxBytes: number;
  measuredOn: string;
  /** Which cycle `measuredMaxBytes` came from. Without it the drift check compares a 2019
   *  number against a 2023 corpus and calls a correct record stale — or worse, the reverse. */
  measuredCycle: string;
  /** Stated so a reader of the table does not have to re-derive the comparison. */
  reason: string;
  /** ⚠ PRESENT ONLY WHERE THE LEVEL IS KNOWINGLY OVER BUDGET. Its absence is what makes
   *  "over budget" a failure; its presence is a decision on the record with the arithmetic
   *  attached, so growth re-opens it rather than quietly widening the exemption. */
  budgetWaiver?: BudgetWaiver;
};

/** Re-measured 2026-09-03 against `data/2026_04_19` (parliamentary) and `data/2023_10_29_mi`
 *  (local), by `npm run elections:budget`. The plan's own table was measured 2026-09-01 and
 *  every row it predicted held; the numbers below are the current ones.
 *
 *  ⚠ `local/region` was the plan's one open row ("measure in Phase 1"). Measured: 12.5 KB mean
 *  over 29 files but **28.7 KB at SFO**, i.e. 1.8x over a 16 KiB budget on the largest oblast —
 *  and the largest oblast is Sofia, the most-read one. A mean inside a budget is not a level
 *  inside a budget, so it EMITS. */
export const SURFACE_POLICY: Record<
  ElectionKind,
  Record<ElectionPlaceLevel, SurfaceLevelPolicy>
> = {
  parliamentary: {
    country: {
      source: "canonical",
      canonicalNote: "national_summary.json",
      measuredMaxBytes: 14_428,
      measuredCycle: "2026_04_19",
      measuredOn: "2026-09-03",
      reason: "one file, inside the 24 KiB country budget",
    },
    region: {
      source: "artifact",
      canonicalNote: "computed client-side across shards",
      measuredMaxBytes: 0,
      measuredCycle: "n/a",
      measuredOn: "2026-09-03",
      reason:
        "no single canonical file — the headline is a client-side fan-out across shards",
    },
    abroad: {
      source: "artifact",
      canonicalNote: "computed client-side across shards",
      measuredMaxBytes: 0,
      measuredCycle: "n/a",
      measuredOn: "2026-09-03",
      reason: "oblast 32, same fan-out as a region; declares level abroad",
    },
    municipality: {
      source: "canonical",
      canonicalNote: "municipalities/<code>.json",
      measuredMaxBytes: 2_553,
      measuredCycle: "2026_04_19",
      measuredOn: "2026-09-03",
      reason: "2.3 KB mean over 305 files, well inside 16 KiB",
    },
    // ⚠ THE PLAN MARKED THIS `no — inside budget` ON THE MEAN, AND THE MEAN IS THE WRONG
    // STATISTIC HERE. Measured 2026-09-03 over 5,364 settlements: p50 4.0 KB, p90 7.5 KB —
    // and p99 **101.6 KB**, max **1,235.2 KB** (Пловдив, ekatte 56784; Бургас 1,030.9;
    // Варна 831.3). 208 files (3.9%) are over the 16 KiB budget, and those 208 are the CITIES,
    // i.e. the settlement pages anyone actually opens. A heavy tail does not average away: the
    // reader of the largest settlement page downloads 1.2 MB for a first screen budgeted at 16
    // KiB. Emitting costs 5,364 objects for one parliamentary cycle, which §5.0's object-count
    // argument comfortably permits, and the projection is ~3 KB against a 4.0 KB median — so it
    // is smaller everywhere, not merely at the tail.
    settlement: {
      source: "artifact",
      canonicalNote: "settlements/<ekatte>.json",
      measuredMaxBytes: 1_264_795,
      measuredCycle: "2026_04_19",
      measuredOn: "2026-09-03",
      reason:
        "p99 101.6 KB and max 1,235.2 KB against 16 KiB — 208 of 5,364 over, and they are the cities",
    },
    section: {
      source: "artifact",
      canonicalNote: "sections/by-oblast/<oblast>.json",
      measuredMaxBytes: 1_880_408,
      measuredCycle: "2026_04_19",
      measuredOn: "2026-09-03",
      reason:
        "978.7 KB mean and 1,836 KB max per oblast shard against an 8 KiB route budget — 12,721 sections in 32 files, not route-sized",
    },
  },
  local: {
    country: {
      source: "artifact",
      canonicalNote:
        "index.json + regions_summary + national_leaders + national_municipalities",
      measuredMaxBytes: 105_767,
      measuredCycle: "2019_10_27_mi",
      measuredOn: "2026-09-03",
      reason: "a four-file fan-out, index.json alone 92 KB against 24 KiB",
    },
    region: {
      source: "artifact",
      canonicalNote: "region/<oblast>.json",
      measuredMaxBytes: 32_407,
      measuredCycle: "2019_10_27_mi",
      measuredOn: "2026-09-03",
      reason:
        "28.7 KB at SFO against 16 KiB — the mean (12.5 KB) is inside, the largest oblast is not",
    },
    abroad: {
      source: "none",
      canonicalNote: "not applicable — local elections are not held abroad",
      measuredMaxBytes: 0,
      measuredCycle: "n/a",
      measuredOn: "2026-09-03",
      reason:
        "the kind x level does not exist; the descriptor matrix marks it unavailable",
    },
    municipality: {
      source: "artifact",
      canonicalNote: "municipalities/<code>.json",
      measuredMaxBytes: 482_759,
      measuredCycle: "2019_10_27_mi",
      measuredOn: "2026-09-03",
      reason:
        "59.9 KB mean over 289 files against 16 KiB, and 417.6 KB at SOF — 3.7x over on the mean alone",
    },
    settlement: {
      source: "artifact",
      canonicalNote: "inherits the parent municipality bundle",
      measuredMaxBytes: 482_759,
      measuredCycle: "2019_10_27_mi",
      measuredOn: "2026-09-03",
      reason:
        "no settlement file exists; a settlement reader downloads the whole municipality bundle",
    },
    section: {
      source: "embedded",
      canonicalNote: "sections/<obshtina>/<code>.json",
      measuredMaxBytes: 11_696,
      measuredCycle: "2019_10_27_mi",
      measuredOn: "2026-09-03",
      reason:
        "over budget and knowingly accepted — see budgetWaiver. The reader fetches ONE file and gets the surface plus the complete station detail",
      // ⚠ THE REASON THIS IS ACCEPTED IS THE OBJECT COUNT, NOT A RE-READING OF THE BUDGET.
      // §5.0: emitting a section artifact per cycle is ~12,300 objects, and v1 covers two local
      // cycles. Paying 24,596 objects to save 3.4 KB on the worst station — 1.43x over at its
      // worst measured cycle (2019; 2023 is 1.26x) — against
      // the 77x that justified flipping parliamentary/settlement for 5,364 objects — is the
      // trade §5.0's object-count argument exists to refuse. Consistent with that decision, not
      // an exception to it.
      budgetWaiver: {
        objectCost: 24_596,
        worstCaseOverBy: 1.43,
        bytesSaved: 11_696 - 8 * 1024,
        note: "24,596 objects to save 3.4 KB at 1.43x over; parliamentary/settlement bought 77x for 5,364",
      },
    },
  },
};

/** The levels that get their own file. Derived, never restated: a policy edit moves this set. */
export const emittedLevels = (
  kind: ElectionKind,
): readonly ElectionPlaceLevel[] =>
  (
    Object.entries(SURFACE_POLICY[kind]) as [
      ElectionPlaceLevel,
      SurfaceLevelPolicy,
    ][]
  )
    .filter(([, p]) => p.source === "artifact")
    .map(([level]) => level);

/** ⚠ SECTIONS ARE SHARDED, NEVER FLAT (§5.0). 12,721 files in one directory is a listing and
 *  filesystem cost with no upside, and `sections/by-oblast/` already establishes the prefix. */
export const sectionOblastOf = (sectionCode: string): string =>
  sectionCode.slice(0, 2);

/** WHERE to read a place's first screen from — a discriminated answer, because the three
 *  reasons there is no artifact path are three different instructions to the caller.
 *
 *  ⚠ A BARE `string | null` CONFLATES THEM, and the collapse is silent. `null` meant "this
 *  level never emits", "this level emits but no id has arrived yet" and "this kind x level does
 *  not exist" interchangeably, so the obvious `if (!path) return legacy()` fires while an id is
 *  merely still loading — and the page renders the legacy body for ever, at a 200, which is the
 *  exact failure this module's header is about. */
export type SurfaceLocation =
  /** Fetch this path. */
  | { source: "artifact"; path: string }
  /** Read the canonical shard through the per-level adapter — there is no second file. */
  | { source: "canonical" }
  /** Read the `surface` key inside the canonical shard. */
  | { source: "embedded" }
  /** This kind x level does not exist; render the descriptor's reason, never an empty result. */
  | { source: "none" }
  /** This level DOES emit, but no place id was supplied — usually a route param still
   *  resolving. WAIT; do not fall back, and do not fetch. */
  | { source: "pending" };

export const locateSurface = (
  kind: ElectionKind,
  level: ElectionPlaceLevel,
  cycle: string,
  id?: string,
): SurfaceLocation => {
  const { source } = SURFACE_POLICY[kind][level];
  if (source !== "artifact") return { source };
  const path = artifactPath(level, cycle, id);
  return path ? { source: "artifact", path } : { source: "pending" };
};

/** The path an `artifact` level writes to, relative to the data root and WITHOUT a leading
 *  slash — the generator joins it onto `data/`, the runtime hands it to `dataUrl`.
 *
 *  Prefer `locateSurface` in the runtime; this is the generator's half, where the level is
 *  known to emit and the id is always in hand. Returns `null` only for a missing id. */
export const artifactPath = (
  level: ElectionPlaceLevel,
  cycle: string,
  id?: string,
): string | null => {
  switch (level) {
    case "country":
      return `${cycle}/surface/country.json`;
    // ⚠ ABROAD IS A REGION ON DISK. It is oblast 32 — one shard among the region shards — and
    // splitting it into its own directory would give the same data two paths. The artifact
    // declares `place.level: "abroad"` so the DESCRIPTOR still selects the abroad composition,
    // which is where the difference belongs (no turnout, §8).
    case "abroad":
    case "region":
      return id ? `${cycle}/surface/region/${id}.json` : null;
    case "municipality":
      return id ? `${cycle}/surface/municipality/${id}.json` : null;
    case "settlement":
      return id ? `${cycle}/surface/settlement/${id}.json` : null;
    case "section":
      return id
        ? `${cycle}/surface/section/by-oblast/${sectionOblastOf(id)}/${id}.json`
        : null;
  }
};
