import { describe, expect, it } from "vitest";
import {
  countSources,
  mergeGeoOverrides,
  producibleSources,
  SOURCE_RANK,
  TIER_LABELS,
  type GeoEntry,
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

/** Merge helper that defaults `candidateEiks` to "every eik mentioned is still
 *  a candidate" — the normal case. */
const merge = (
  prior: Record<string, GeoEntry>,
  fresh: Record<string, GeoEntry>,
  inputs: TierInputs,
  candidateEiks = new Set([...Object.keys(prior), ...Object.keys(fresh)]),
) => mergeGeoOverrides(prior, fresh, producibleSources(inputs), candidateEiks);

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

  it("declares a tier for every source label it can emit", () => {
    const gated = new Set(Object.values(TIER_LABELS).flat());
    for (const label of producibleSources(ALL_UP))
      expect(gated).toContain(label);
    // …and every rank-carrying label is producible, so no label can be minted
    // that the availability model has never heard of.
    for (const label of Object.keys(SOURCE_RANK))
      expect(producibleSources(ALL_UP).has(label)).toBe(true);
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
      new Set(),
    );
    expect(awarders["2"]).toBeUndefined();
    expect(report.retired).toBe(1);
    expect(report.unresolved).toBe(0);
  });

  it("ignores a malformed prior entry", () => {
    const { awarders } = merge(
      { "9": { ekatte: "", source: "mon", confidence: "x" } },
      {},
      { ...ALL_UP, mon: false },
    );
    expect(awarders["9"]).toBeUndefined();
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
