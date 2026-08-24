import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  compareSeatsToMap,
  countSources,
  mergeGeoOverrides,
  producibleSources,
  SHRINK_TOLERANCE,
  shrinkVerdict,
  SOURCE_RANK,
  TIER_KEYS,
  TIER_LABELS,
  tierAgeDays,
  type GeoEntry,
  type MergeReport,
  type TierInputs,
} from "./awarder_geo_merge";

const ALL_UP: TierInputs = {
  ri: true,
  tr: true,
  school: true,
  ocds: true,
  mon: true,
  oblast: true,
};

const entry = (ekatte: string, source: string): GeoEntry => ({
  ekatte,
  source,
  confidence: source === "ri" ? "exact" : "name_only",
});

/** Merge helper that defaults `candidateEiks` / `knownEiks` to "every eik
 *  mentioned is still in the dir and still a candidate" — the normal case. */
const merge = (
  prior: Record<string, GeoEntry>,
  fresh: Record<string, GeoEntry>,
  inputs: TierInputs,
  candidateEiks = new Set([...Object.keys(prior), ...Object.keys(fresh)]),
  knownEiks = new Set([...Object.keys(prior), ...Object.keys(fresh)]),
) =>
  mergeGeoOverrides(
    prior,
    fresh,
    producibleSources(inputs),
    candidateEiks,
    knownEiks,
  );

// The tier→labels relation, restated INDEPENDENTLY of TIER_LABELS. Deriving the
// expectation from the table under test would make the assertion self-consistent
// with whatever the table happens to say — which is the drift this exists to
// catch, since producibleSources is now derived from that same table.
const GATES: Record<string, string[]> = {
  ri: ["ri"],
  tr: ["tr"],
  school: ["school"],
  ocds: ["ocds"],
  mon: ["mon", "mon+oblast"],
  oblast: ["mon+oblast", "name+oblast"],
};
const ALL_LABELS = [...new Set(Object.values(TIER_LABELS).flat())].sort();

const emptyReport = (over: Partial<MergeReport> = {}): MergeReport => ({
  carried: {},
  retired: 0,
  vanished: 0,
  unresolved: 0,
  malformed: 0,
  changed: 0,
  unknownSources: [],
  ...over,
});

describe("producibleSources", () => {
  it("gates the +oblast labels on BOTH their tier and the Tier-D hint", () => {
    expect([...producibleSources(ALL_UP)].sort()).toEqual([
      "mon",
      "mon+oblast",
      "name",
      "name+oblast",
      "ocds",
      "ri",
      "school",
      "tr",
    ]);
    // Tier D alone going down takes the two oblast-pinned labels with it — the
    // shape that makes a missing buyer_oblast_map.json shrink the map exactly
    // like a blocked МОН fetch.
    const noOblast = producibleSources({ ...ALL_UP, oblast: false });
    expect(noOblast.has("mon+oblast")).toBe(false);
    expect(noOblast.has("name+oblast")).toBe(false);
    expect(noOblast.has("mon")).toBe(true);
    // Tier A is a parse of the awarder's own name; it can never be unavailable.
    expect(
      producibleSources({
        ri: false,
        tr: false,
        school: false,
        ocds: false,
        mon: false,
        oblast: false,
      }),
    ).toEqual(new Set(["name"]));
  });

  it("removes exactly the labels a downed tier gates, and no others", () => {
    for (const tier of TIER_KEYS) {
      if (tier === "name") continue; // a local parse; never unavailable
      const got = producibleSources({ ...ALL_UP, [tier]: false });
      for (const label of ALL_LABELS)
        expect(
          got.has(label),
          `${tier} down → is ${label} still producible?`,
        ).toBe(!GATES[tier].includes(label));
    }
  });

  it("keeps SOURCE_RANK and the tier table in agreement", () => {
    // Neither may name a label the other has never heard of: a ranked label
    // that no tier gates could never be produced, and a gated label with no
    // rank sorts to Infinity and silently loses every priority comparison.
    expect(ALL_LABELS).toEqual(Object.keys(SOURCE_RANK).sort());
  });
});

describe("mergeGeoOverrides — a blocked tier does not shrink the map", () => {
  // The measured 2026-08-10 incident: data.egov.bg 403'd, Tier B contributed
  // nothing, and the map went 2,164 → 2,071 at exit 0.
  const prior: Record<string, GeoEntry> = {
    "1": entry("00001", "ri"),
    "2": entry("00002", "mon"),
    "3": entry("00003", "mon+oblast"),
    "4": entry("00004", "name"),
  };
  const freshWithoutMon: Record<string, GeoEntry> = {
    "1": entry("00001", "ri"),
    "4": entry("00004", "name"),
  };

  it("carries the blocked tier's entries over", () => {
    const { awarders, report } = merge(prior, freshWithoutMon, {
      ...ALL_UP,
      mon: false,
    });
    expect(Object.keys(awarders).length).toBe(Object.keys(prior).length);
    expect(awarders["2"]).toEqual(prior["2"]);
    expect(awarders["3"]).toEqual(prior["3"]);
    expect(report.carried).toEqual({ mon: 1, "mon+oblast": 1 });
    expect(report.unresolved).toBe(0);
  });

  it("does the same when the Tier-D hint file is the thing that is missing", () => {
    // Without the oblast hint, `mon+oblast` cannot be re-derived and the awarder
    // falls through to a lower tier — or to nothing, as here.
    const { awarders, report } = merge(
      prior,
      { "1": entry("00001", "ri"), "2": entry("00002", "mon") },
      { ...ALL_UP, oblast: false },
    );
    expect(awarders["3"]).toEqual(prior["3"]);
    expect(report.carried["mon+oblast"]).toBe(1);
    // `name` is producible without the hint, so a `name` entry that stopped
    // resolving is a real drop, not a carried one.
    expect(report.unresolved).toBe(1);
    expect(awarders["4"]).toBeUndefined();
  });

  it("keeps every fetched tier's entries when the whole derived layer is gone", () => {
    const { awarders, report } = merge(
      prior,
      {},
      {
        ri: false,
        tr: false,
        school: false,
        ocds: false,
        mon: false,
        oblast: false,
      },
    );
    // …but NOT the `name` entry: Tier A is a local parse of the awarder's own
    // name, so it ran, and its silence is a real answer. This is the line that
    // proves the model discriminates rather than carrying everything forever.
    expect(Object.keys(awarders).sort()).toEqual(["1", "2", "3"]);
    expect(report.unresolved).toBe(1);
  });
});

describe("mergeGeoOverrides — what it IS allowed to drop", () => {
  it("drops an entry whose tier ran and no longer resolves it", () => {
    const { awarders, report } = merge(
      { "2": entry("00002", "mon") },
      {},
      ALL_UP,
    );
    expect(awarders["2"]).toBeUndefined();
    expect(report.unresolved).toBe(1);
    expect(report.carried).toEqual({});
  });

  it("retires an entry whose awarder is no longer an override candidate", () => {
    // The awarder gained a real OCDS address, so it was never offered to any
    // tier — and rollups prefers an address-derived geo anyway. Dropped even
    // though the tier that produced it is down.
    const { awarders, report } = merge(
      { "2": entry("00002", "mon") },
      {},
      { ...ALL_UP, mon: false },
      new Set(), // not a candidate…
      new Set(["2"]), // …but still in the awarders dir
    );
    expect(awarders["2"]).toBeUndefined();
    expect(report.retired).toBe(1);
    expect(report.vanished).toBe(0);
    expect(report.unresolved).toBe(0);
  });

  it("counts an awarder that left the dir as vanished, not retired", () => {
    // Same drop, entirely different cause: a half-rebuilt awarders dir is a
    // broken ingest, and reporting it as "gained an address" attributes a
    // failure to a normal data improvement.
    const { report } = merge(
      { "2": entry("00002", "mon") },
      {},
      ALL_UP,
      new Set(),
      new Set(), // gone from the dir
    );
    expect(report.vanished).toBe(1);
    expect(report.retired).toBe(0);
  });

  it("drops a malformed prior entry AND accounts for it", () => {
    // It reduces the map size, so leaving it out of every counter is one of the
    // ways the guard's message stops reconciling with the size it quotes.
    const { awarders, report } = merge(
      { "9": { ekatte: "", source: "mon", confidence: "x" } },
      {},
      { ...ALL_UP, mon: false },
    );
    expect(awarders["9"]).toBeUndefined();
    expect(report.malformed).toBe(1);
    expect(report.retired + report.vanished + report.unresolved).toBe(0);
  });
});

describe("mergeGeoOverrides — tier priority when both sides have an answer", () => {
  it("keeps the down tier's answer when it outranks this run's", () => {
    // Tier R is the most authoritative source; a `name` parse resolving the
    // same awarder must not overwrite a carried `ri` entry.
    const { awarders, report } = merge(
      { "1": entry("00001", "ri") },
      { "1": entry("00099", "name") },
      { ...ALL_UP, ri: false },
    );
    expect(awarders["1"]).toEqual(entry("00001", "ri"));
    expect(report.carried).toEqual({ ri: 1 });
  });

  it("takes this run's answer when a LIVE tier outranks the down one", () => {
    // Tier B is down, but Tier R ran and placed the awarder. A genuine
    // improvement from a higher tier is not something the guard should suppress.
    const { awarders, report } = merge(
      { "1": entry("00001", "mon") },
      { "1": entry("00099", "ri") },
      { ...ALL_UP, mon: false },
    );
    expect(awarders["1"]).toEqual(entry("00099", "ri"));
    expect(report.carried).toEqual({});
    expect(report.changed).toBe(1);
  });

  it("keeps an oblast-pinned entry over a same-rank bare re-resolve", () => {
    // `name` and `name+oblast` share a rank on purpose, so the tie goes to the
    // carried entry: an oblast-pinned answer outranks a bare re-resolve whose
    // pin can no longer be derived. A later `<` for `<=` silently inverts this.
    const { awarders, report } = merge(
      { "1": entry("00001", "name+oblast") },
      { "1": entry("00099", "name") },
      { ...ALL_UP, oblast: false },
    );
    expect(awarders["1"]).toEqual(entry("00001", "name+oblast"));
    expect(report.carried).toEqual({ "name+oblast": 1 });
  });

  it("lets a live tier re-resolve an awarder to a different EKATTE", () => {
    const { awarders, report } = merge(
      { "1": entry("00001", "ri") },
      { "1": entry("00099", "ri") },
      ALL_UP,
    );
    expect(awarders["1"]).toEqual(entry("00099", "ri"));
    expect(report.changed).toBe(1);
  });
});

describe("mergeGeoOverrides — unrecognised prior labels", () => {
  it("carries them and reports them rather than silently dropping", () => {
    // A renamed tier must not quietly delete its own history: this build cannot
    // verify that a tier it can't name ran, so it keeps the entry and says so.
    const { awarders, report } = merge(
      { "1": entry("00001", "legacy-tier") },
      {},
      ALL_UP,
    );
    expect(awarders["1"]).toEqual(entry("00001", "legacy-tier"));
    expect(report.unknownSources).toEqual(["legacy-tier"]);
    expect(report.carried).toEqual({ "legacy-tier": 1 });
  });
});

describe("shrinkVerdict", () => {
  it("never refuses on a first build, however empty", () => {
    // priorCount === 0 is a legitimate first build. This short-circuit is
    // exactly the kind of clause a later edit inverts without anyone noticing.
    expect(shrinkVerdict(0, emptyReport({ unresolved: 999 })).refuse).toBe(
      false,
    );
  });

  it("passes the incident's own 4.3% and refuses just past the tolerance", () => {
    expect(shrinkVerdict(2164, emptyReport({ unresolved: 93 })).refuse).toBe(
      false,
    );
    expect(shrinkVerdict(2164, emptyReport({ unresolved: 111 })).refuse).toBe(
      true,
    );
  });

  it("counts GROSS loss, so growth cannot mask it", () => {
    // The net form (priorCount - finalCount) reads flat when a run resolves as
    // many new awarders as it drops old ones. Gross never sees the new ones.
    const { lost, pct } = shrinkVerdict(
      1000,
      emptyReport({ retired: 20, vanished: 30, unresolved: 40, malformed: 10 }),
    );
    expect(lost).toBe(100);
    expect(pct).toBeCloseTo(0.1);
  });

  it("still discriminates — the same input flips when the tolerance moves", () => {
    // Mutation check: without it, the passing assertion above is satisfied by
    // any verdict that simply never refuses.
    const report = emptyReport({ unresolved: 93 });
    expect(shrinkVerdict(2164, report, SHRINK_TOLERANCE).refuse).toBe(false);
    expect(shrinkVerdict(2164, report, 0).refuse).toBe(true);
  });
});

describe("countSources", () => {
  it("counts the map that was written, not the run that built it", () => {
    const { awarders } = merge(
      { "2": entry("00002", "mon"), "3": entry("00003", "mon+oblast") },
      { "1": entry("00001", "ri") },
      { ...ALL_UP, mon: false },
    );
    expect(countSources(awarders)).toEqual({ ri: 1, mon: 1, "mon+oblast": 1 });
  });
});

describe("tierAgeDays", () => {
  // The staleness ratchet in awarder_geo_overrides.test.ts can only read the
  // committed artifact from a fixed path, so before this helper existed the only
  // way to exercise its branches was to MUTATE that git-tracked file and restore
  // it — unsafe in a repo where another process commits to `main`. `now` is
  // injected, so these need no fake timers.
  const NOW = Date.parse("2026-08-24T00:00:00Z");
  const daysAgo = (d: number): string =>
    new Date(NOW - d * 86_400_000).toISOString();

  it("measures whole days back from the injected clock", () => {
    expect(tierAgeDays(daysAgo(3), NOW)).toBeCloseTo(3, 10);
    expect(tierAgeDays(daysAgo(14.1), NOW)).toBeCloseTo(14.1, 10);
  });

  it("straddles the ratchet's 14-day threshold in both directions", () => {
    // The pair the gate actually turns on: 13.9 rides, 14.1 fires. Both render
    // as "14" under toFixed(0), which is why the message uses one decimal.
    expect(tierAgeDays(daysAgo(13.9), NOW)).toBeLessThan(14);
    expect(tierAgeDays(daysAgo(14.1), NOW)).toBeGreaterThan(14);
  });

  it("returns NaN for a missing or unparseable stamp, never 0 or Infinity", () => {
    // NaN fails every `<` comparison, so the gate refuses rather than passing an
    // un-ageable tier. 0 would read as "fresh today" — the dangerous direction.
    for (const bad of [undefined, "", "not a date", "2026-13-45"]) {
      expect(tierAgeDays(bad, NOW), `stamp ${JSON.stringify(bad)}`).toBeNaN();
      expect(tierAgeDays(bad, NOW) < 14, `stamp ${JSON.stringify(bad)}`).toBe(
        false,
      );
    }
  });

  it("goes negative on a future stamp rather than clamping", () => {
    // A clock-skewed stamp must not silently read as ancient; the gate's `<`
    // then passes it, which is the safe direction for a skew we cannot judge.
    expect(tierAgeDays(daysAgo(-2), NOW)).toBeCloseTo(-2, 10);
  });
});

describe("compareSeatsToMap", () => {
  // The published table is what a reader sees; the committed map is what we
  // decided. These are the four shapes that tell them apart.
  const geo = (ekatte: string) => ({ ekatte, source: "mon", confidence: "x" });

  it("reports no drift when every map entry is published at the same EKATTE", () => {
    const drift = compareSeatsToMap(
      { "1": geo("47714"), "2": geo("39921") },
      new Map([
        ["1", "47714"],
        ["2", "39921"],
      ]),
    );
    expect(drift).toEqual({ missing: [], disagreeing: [], checked: 2 });
  });

  it("names the buyer, both EKATTE and which side each came from", () => {
    // The real 2026-08-24 drift: the map said Мездра, prod still said Дърманци.
    // The message has to carry all three or an operator cannot tell which side
    // is stale.
    const drift = compareSeatsToMap(
      { "106633686": geo("47714") },
      new Map([["106633686", "24668"]]),
    );
    expect(drift.disagreeing).toEqual([
      { eik: "106633686", map: "47714", seats: "24668" },
    ]);
    expect(drift.missing).toEqual([]);
    expect(drift.checked).toBe(1);
  });

  it("separates a never-published buyer from a moved one", () => {
    // Different causes, different fixes: `missing` is usually a loader that
    // never ran or a half-built awarders dir; `disagreeing` is one side moving.
    const drift = compareSeatsToMap(
      { a: geo("111"), b: geo("222") },
      new Map([["b", "999"]]),
    );
    expect(drift.missing).toEqual(["a"]);
    expect(drift.disagreeing).toEqual([{ eik: "b", map: "222", seats: "999" }]);
  });

  it("ignores seats rows the map does not name", () => {
    // `awarder_seats` holds ~1,707 buyers the override map never speaks for —
    // 1,657 address-derived, 41 name-parsed and 9 curated — because the map is
    // applied FILL-MISSING. Reporting them would make the gate fire on every
    // healthy corpus.
    const drift = compareSeatsToMap(
      { a: geo("111") },
      new Map([
        ["a", "111"],
        ["zzz", "888"],
      ]),
    );
    expect(drift).toEqual({ missing: [], disagreeing: [], checked: 1 });
  });

  it("counts nothing for an empty map, which is what makes `checked` load-bearing", () => {
    // ⚠ THE VACUITY VECTOR, and it is the map rather than the seats. An empty
    // SEATS table is loud — every map entry lands in `missing`. An empty or
    // unparseable MAP is silent: both arms come back empty and the gate reports
    // success. `checked` is the only field that distinguishes "nothing is wrong"
    // from "nothing was compared", which is why a consumer must assert a FLOOR
    // on it and never `checked === Object.keys(map).length` — that equality is
    // 0 === 0 here. The contract is on the field itself in awarder_geo_merge.ts.
    expect(compareSeatsToMap({}, new Map([["a", "1"]]))).toEqual({
      missing: [],
      disagreeing: [],
      checked: 0,
    });
    const empty = compareSeatsToMap(
      { a: geo("111"), b: geo("222") },
      new Map(),
    );
    expect(empty.missing).toEqual(["a", "b"]);
    expect(empty.checked).toBe(2);
  });

  it("skips a malformed map entry rather than reporting it as unpublished", () => {
    // A map entry with no ekatte is a corrupt artifact, not an undeployed one,
    // and awarder_geo_overrides.test.ts already fails on it. Counting it here
    // would point the operator at the loader for a problem in the file.
    const drift = compareSeatsToMap(
      { a: geo("111"), bad: { ekatte: "", source: "mon", confidence: "x" } },
      new Map([["a", "111"]]),
    );
    expect(drift).toEqual({ missing: [], disagreeing: [], checked: 1 });
  });

  it("orders both arms deterministically", () => {
    // The gate's failure message is read by a human and diffed across runs; an
    // unordered Object.entries walk would reshuffle it for no reason.
    const drift = compareSeatsToMap(
      { c: geo("3"), a: geo("1"), b: geo("2") },
      new Map([
        ["a", "9"],
        ["c", "9"],
      ]),
    );
    expect(drift.missing).toEqual(["b"]);
    expect(drift.disagreeing.map((d) => d.eik)).toEqual(["a", "c"]);
  });
});

describe("compareSeatsToMap — the properties a mutant would otherwise survive", () => {
  const geo = (ekatte: string) => ({ ekatte, source: "mon", confidence: "x" });

  it("sorts `missing` by ЕИК, which JS object order does NOT do for real keys", () => {
    // Deleting `drift.missing.sort()` passed every other test in this file,
    // because their fixtures use keys already in insertion order. Real ЕИК are
    // not: JS enumerates index-like integer keys FIRST and in numeric order, so
    // an unsorted walk over the committed map starts at `101005300` while the
    // sorted one starts at `000000210`. This fixture reproduces that shape.
    const drift = compareSeatsToMap(
      {
        "101005300": geo("1"),
        "000000210": geo("2"),
        "175076479999": geo("3"),
      },
      new Map(),
    );
    expect(drift.missing).toEqual(["000000210", "101005300", "175076479999"]);
  });

  it("treats a published-but-unplaced buyer as missing, not as a null disagreement", () => {
    // `awarder_seats.ekatte` is NULLable (021) and the loader writes `?? null`.
    // Under `seat === undefined` such a row falls through to the else branch and
    // publishes „seats: null" as a disagreement — a correct verdict with a
    // message that reads as a data-shape bug. `missing` is the arm whose remedy
    // (re-run the loader) actually matches.
    const drift = compareSeatsToMap(
      { a: geo("111"), b: geo("222") },
      new Map<string, string | null>([
        ["a", null],
        ["b", "222"],
      ]),
    );
    expect(drift.missing).toEqual(["a"]);
    expect(drift.disagreeing).toEqual([]);
  });

  it("is a pure module — no filesystem, no network, no argv", () => {
    // The reason every rule in this family lives here rather than in its
    // consumer. An import added to this file makes the merge, the ratchet and
    // the seats comparison untestable in the same breath, and the failure is
    // silent: the tests keep passing while the module stops being the thing
    // they were split out to test.
    const src = readFileSync(
      new URL("./awarder_geo_merge.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/\brequire\(/);
    expect(src).not.toMatch(/\bprocess\.(argv|env)\b/);
  });
});
