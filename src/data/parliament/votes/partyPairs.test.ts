// The five identity rules in partyPairs.ts, each pinned against the real shape that
// motivated it. Fixtures are shaped like the artifact rather than invented: the 51st NS
// genuinely carries „ГЕРБ - СДС" (3,698 items) beside „ГЕРБ-СДС" (177) and a „ДПС" of 13,
// it genuinely seats ДПС-НН next to АПС and ДПС-ДПС, and ПП/ДБ genuinely sit as one group
// in the 49th and as two in the 52nd.
//
// The two curated rules (4: a coalition lends its row to its parts; 5: a rename keeps its
// arc) get the most tests here, because they are the ones that can publish a continuity
// that is not in the data.

import { describe, expect, it } from "vitest";
import {
  buildPairSeries,
  canonGroupKey,
  groupsForSlice,
  GROUP_CONTINUATIONS,
  identitiesForSlice,
  movementFor,
  pairId,
  parliamentsIn,
} from "./partyPairs";
import type { PartyCorrelationFile } from "./types";

const slice = (
  parties: [string, number][],
  matrix: number[][],
): {
  parties: string[];
  matrix: number[][];
  participation: Record<string, number>;
} => ({
  parties: parties.map(([p]) => p),
  matrix,
  participation: Object.fromEntries(parties),
});

describe("canonGroupKey", () => {
  it("folds whitespace around the hyphen", () => {
    expect(canonGroupKey("ГЕРБ - СДС")).toBe(canonGroupKey("ГЕРБ-СДС"));
    expect(canonGroupKey("ПП – ДБ")).toBe(canonGroupKey("ПП-ДБ"));
  });

  // The fold is TYPOGRAPHIC and stops there. Two different names are never equated at this
  // level, no matter how similar — the deliberate joins are rules 4 and 5, which are
  // curated by hand and mark every point they produce. Left to a spelling rule, „ДПС - НН"
  // and „ДПС - ДПС" would both collapse into „ДПС", i.e. the two sides of the 51st's split
  // silently becoming one series.
  it("does NOT merge two different names", () => {
    expect(canonGroupKey("ДПС - НН")).not.toBe(canonGroupKey("ДПС"));
    expect(canonGroupKey("БСП - ОЛ")).not.toBe(canonGroupKey("БСП"));
  });
});

describe("groupsForSlice", () => {
  it("keeps the busiest spelling and drops the duplicate", () => {
    const groups = groupsForSlice(
      slice(
        [
          ["ГЕРБ - СДС", 3698],
          ["ГЕРБ-СДС", 177],
          ["ИТН", 3823],
        ],
        [
          [1, 0.5, 0.6],
          [0.5, 1, 0.4],
          [0.6, 0.4, 1],
        ],
      ),
    );
    expect(groups.map((g) => g.raw).sort()).toEqual(["ГЕРБ - СДС", "ИТН"]);
    // The INDEX matters more than the name: it is what indexes the matrix, so picking the
    // duplicate would read the wrong row of cosines under the right label.
    expect(groups.find((g) => g.key === "ГЕРБ-СДС")?.index).toBe(0);
  });

  it("drops the unaffiliated buckets", () => {
    const groups = groupsForSlice(
      slice(
        [
          ["ГЕРБ-СДС", 1000],
          ["НЕЗ", 900],
          ["НЕЧЛ В ПГ", 800],
        ],
        [
          [1, 0.2, 0.3],
          [0.2, 1, 0.4],
          [0.3, 0.4, 1],
        ],
      ),
    );
    expect(groups.map((g) => g.key)).toEqual(["ГЕРБ-СДС"]);
  });

  it("drops a residue that is below either floor", () => {
    const groups = groupsForSlice(
      slice(
        [
          ["БСП - ОЛ", 3862],
          ["ДПС", 13], // both floors
          ["ВЕЛИЧИЕ", 300], // 7.8% and 300 items — thin but real, kept
        ],
        [
          [1, 0.1, 0.2],
          [0.1, 1, 0.3],
          [0.2, 0.3, 1],
        ],
      ),
    );
    expect(groups.map((g) => g.key)).toEqual(["БСП-ОЛ", "ВЕЛИЧИЕ"]);
  });

  it("keeps a small group in a short parliament (the relative floor alone is not enough)", () => {
    // The 45th sat 17 days: its busiest group has 201 items, so an absolute floor tuned
    // for a full term would empty the parliament entirely.
    const groups = groupsForSlice(
      slice(
        [
          ["ДПС", 201],
          ["ГЕРБ-СДС", 174],
        ],
        [
          [1, 0.17],
          [0.17, 1],
        ],
      ),
    );
    expect(groups).toHaveLength(2);
  });
});

describe("identitiesForSlice (a coalition standing in for its components)", () => {
  // The 49th's real shape: ПП and ДБ sat as ПП-ДБ, so neither has a row of its own.
  const coalitionNs = slice(
    [
      ["ГЕРБ-СДС", 3644],
      ["ПП - ДБ", 3629],
      ["ДПС", 3614],
    ],
    [
      [1, 0.1, 0.91],
      [0.1, 1, 0.05],
      [0.91, 0.05, 1],
    ],
  );

  it("lends the coalition's row to each component, and keeps no identity of its own", () => {
    const ids = identitiesForSlice(coalitionNs);
    expect(ids.map((i) => i.key).sort()).toEqual([
      "ГЕРБ-СДС",
      "ДБ",
      "ДПС",
      "ПП",
    ]);
    // Never a ПП-ДБ identity beside them: that is the same votes a second time, and the
    // movement board would carry both rows.
    expect(ids.some((i) => i.key === "ПП-ДБ")).toBe(false);
    const pp = ids.find((i) => i.key === "ПП");
    expect(pp?.via).toBe("ПП - ДБ");
    // The label is the COMPONENT's; `via` is the qualifier. Otherwise an axis reading „ПП"
    // would be drawn from a row belonging to ПП-ДБ with nothing saying so.
    expect(pp?.raw).toBe("ПП");
    expect(ids.find((i) => i.key === "ГЕРБ-СДС")?.via).toBeUndefined();
  });

  it("drops the coalition when every component sits separately", () => {
    const ids = identitiesForSlice(
      slice(
        [
          ["ГЕРБ-СДС", 1000],
          ["ПП", 900],
          ["ДБ", 880],
          ["ПП - ДБ", 800],
        ],
        [
          [1, 0.2, 0.3, 0.25],
          [0.2, 1, 0.8, 0.9],
          [0.3, 0.8, 1, 0.9],
          [0.25, 0.9, 0.9, 1],
        ],
      ),
    );
    expect(ids.map((i) => i.key).sort()).toEqual(["ГЕРБ-СДС", "ДБ", "ПП"]);
    expect(ids.every((i) => i.via === undefined)).toBe(true);
  });

  it("refuses to lend on a PARTIAL split, rather than pairing a group against itself", () => {
    // ПП sits separately while ДБ does not. Lending per-component would give ДБ the
    // coalition's row, so ПП↔ДБ would resolve to matrix[ПП][ПП-ДБ] — one group against a
    // coalition containing it, inflated upward, and with a `via` on only one end so it
    // reads as an ordinary observation. No parliament seats this shape today; the guard is
    // here because the failure is a confidently wrong number rather than an empty cell.
    const ids = identitiesForSlice(
      slice(
        [
          ["ГЕРБ-СДС", 1000],
          ["ПП", 900],
          ["ПП - ДБ", 800],
        ],
        [
          [1, 0.2, 0.25],
          [0.2, 1, 0.9],
          [0.25, 0.9, 1],
        ],
      ),
    );
    expect(ids.map((i) => i.key).sort()).toEqual(["ГЕРБ-СДС", "ПП"]);
    // ДБ gets no identity at all: a gap is the honest answer when the only row that could
    // speak for it already contains its sibling.
    expect(ids.some((i) => i.key === "ДБ")).toBe(false);
  });

  it("suppresses the components' OWN pair — the diagonal is 1 by definition", () => {
    const s = buildPairSeries({
      computedAt: "x",
      byNs: { "49": coalitionNs },
    });
    // The trap: both identities read matrix row 1, whose self-cell is 1.0, so ПП↔ДБ would
    // publish a flat 100% agreement for exactly the years they were not voting separately.
    expect(s.get(pairId("ПП", "ДБ"))).toBeUndefined();
    // Everything else is present, and marked.
    expect(s.get(pairId("ГЕРБ-СДС", "ПП"))?.points).toEqual([
      { ns: "49", score: 0.1, via: "ПП - ДБ" },
    ]);
  });
});

describe("identitiesForSlice (a renamed group keeping its arc)", () => {
  // The 51st's real shape: ДПС-НН sits alongside BOTH other successors of the split, and a
  // 13-item „ДПС" residue that the floor removes before any of this runs.
  const splitNs = slice(
    [
      ["ДПС - НН", 3828],
      ["ГЕРБ - СДС", 3698],
      ["АПС", 1807],
      ["ДПС - ДПС", 1675],
      ["ДПС", 13],
    ],
    [
      [1, 0.84, 0.24, 0.39, 0],
      [0.84, 1, 0.3, 0.4, 0],
      [0.24, 0.3, 1, 0.55, 0],
      [0.39, 0.4, 0.55, 1, 0],
      [0, 0, 0, 0, 1],
    ],
  );

  it("substitutes the current name and records the old one", () => {
    const ids = identitiesForSlice(splitNs);
    const dps = ids.find((i) => i.key === "ДПС");
    expect(dps?.via).toBe("ДПС - НН");
    // The label reads „ДПС" on every row of every parliament; only `via` says which row it
    // came from. A raw of „ДПС - НН" here would make one group read two ways depending on
    // which parliament happened to be newest in that particular pair's series.
    expect(dps?.raw).toBe("ДПС");
  });

  it("leaves the OTHER successors of the split alone", () => {
    const ids = identitiesForSlice(splitNs);
    // The whole point: the split stays visible. АПС and ДПС-ДПС are their own groups, and
    // merging any of them would hide the event this parliament is defined by.
    expect(ids.map((i) => i.key).sort()).toEqual([
      "АПС",
      "ГЕРБ-СДС",
      "ДПС",
      "ДПС-ДПС",
    ]);
    expect(ids.find((i) => i.key === "АПС")?.via).toBeUndefined();
    expect(ids.find((i) => i.key === "ДПС-ДПС")?.via).toBeUndefined();
  });

  it("REFUSES the rename when the target name is sitting in the same parliament", () => {
    // Two groups cannot be one row. Here the literal ДПС clears the floor, so both keep
    // their own names rather than one silently overwriting the other.
    const ids = identitiesForSlice(
      slice(
        [
          ["ДПС - НН", 2000],
          ["ДПС", 1800],
        ],
        [
          [1, 0.39],
          [0.39, 1],
        ],
      ),
    );
    expect(ids.map((i) => i.key).sort()).toEqual(["ДПС", "ДПС-НН"]);
    expect(ids.every((i) => i.via === undefined)).toBe(true);
  });

  it("declares the continuations as a curated map, not a pattern match", () => {
    // A rule that inferred „ДПС - X continues ДПС" from the name would also swallow
    // ДПС - ДПС, i.e. the other side of the split. Keys are the OLD name.
    expect(GROUP_CONTINUATIONS).toEqual({
      "ДПС-НН": "ДПС",
      ГЕРБ: "ГЕРБ-СДС",
      "БСП-ОЛ": "БСП",
    });
  });

  it("renames forward, so an arc is spelled the way it is spelled today", () => {
    // The 44th: ГЕРБ before СДС joined. The arc has to be findable under the name the
    // group has now, or the same party reads as two on a page that spans both.
    const ids = identitiesForSlice(
      slice(
        [
          ["ГЕРБ", 989],
          ["БСП", 960],
        ],
        [
          [1, 0.06],
          [0.06, 1],
        ],
      ),
    );
    const gerb = ids.find((i) => i.via === "ГЕРБ");
    expect(gerb?.key).toBe("ГЕРБ-СДС");
    // БСП is untouched here — only „БСП - ОЛ" (the 51st's spelling) is a continuation key,
    // so a plain БСП parliament stays plain.
    expect(ids.find((i) => i.key === "БСП")?.via).toBeUndefined();
  });
});

// Three parliaments with the two shapes side by side: the 49th seats ПП and ДБ as one
// coalition (rule 4 fills their pairs), and ВЪЗРАЖДАНЕ is absent from it entirely (a
// genuine gap that nothing fills).
const file: PartyCorrelationFile = {
  computedAt: "2026-08-11T00:00:00.000Z",
  byNs: {
    // [ГЕРБ-СДС, ДПС, ПП, ДБ, ВЪЗРАЖДАНЕ]
    "48": slice(
      [
        ["ГЕРБ-СДС", 1356],
        ["ДПС", 1352],
        ["ПП", 1338],
        ["ДБ", 1338],
        ["ВЪЗРАЖДАНЕ", 1348],
      ],
      [
        [1, 0.82, 0.27, 0.39, 0.19],
        [0.82, 1, 0.22, 0.31, 0.25],
        [0.27, 0.22, 1, 0.82, 0.27],
        [0.39, 0.31, 0.82, 1, 0.22],
        [0.19, 0.25, 0.27, 0.22, 1],
      ],
    ),
    // [ГЕРБ-СДС, ПП - ДБ, ДПС]
    "49": slice(
      [
        ["ГЕРБ-СДС", 3644],
        ["ПП - ДБ", 3629],
        ["ДПС", 3614],
      ],
      [
        [1, 0.1, 0.91],
        [0.1, 1, 0.05],
        [0.91, 0.05, 1],
      ],
    ),
    // [ГЕРБ - СДС, ПП, ДБ, ДПС, ВЪЗРАЖДАНЕ]
    "52": slice(
      [
        ["ГЕРБ - СДС", 1143],
        ["ПП", 1135],
        ["ДБ", 1133],
        ["ДПС", 1059],
        ["ВЪЗРАЖДАНЕ", 1115],
      ],
      [
        [1, 0.59, 0.5, 0.48, 0.35],
        [0.59, 1, 0.82, 0.23, 0.39],
        [0.5, 0.82, 1, 0.24, 0.31],
        [0.48, 0.23, 0.24, 1, -0.02],
        [0.35, 0.39, 0.31, -0.02, 1],
      ],
    ),
  },
};

describe("buildPairSeries", () => {
  it("threads one pair across parliaments through a spelling change", () => {
    const s = buildPairSeries(file).get(pairId("ГЕРБ-СДС", "ДПС"));
    expect(s?.points).toEqual([
      { ns: "48", score: 0.82 },
      { ns: "49", score: 0.91 },
      { ns: "52", score: 0.48 },
    ]);
    // The label follows the newest spelling, not the oldest.
    expect(s?.aRaw).toBe("ГЕРБ - СДС");
  });

  it("leaves a GAP where the pair did not exist, rather than a zero", () => {
    // ВЪЗРАЖДАНЕ is simply not in the 49th, and no coalition can stand in for it. A zero
    // would read as "they voted orthogonally" when the truth is that one of them was not
    // in the chamber.
    const s = buildPairSeries(file).get(pairId("ГЕРБ-СДС", "ВЪЗРАЖДАНЕ"));
    expect(s?.points.map((p) => p.ns)).toEqual(["48", "52"]);
  });

  it("fills a component's pairs from its coalition, marked with `via`", () => {
    const series = buildPairSeries(file);
    // The hole this rule exists to close: ГЕРБ-СДС↔ПП and ГЕРБ-СДС↔ДБ now carry the 49th.
    expect(series.get(pairId("ГЕРБ-СДС", "ПП"))?.points).toEqual([
      { ns: "48", score: 0.27 },
      { ns: "49", score: 0.1, via: "ПП - ДБ" },
      { ns: "52", score: 0.59 },
    ]);
    expect(series.get(pairId("ГЕРБ-СДС", "ДБ"))?.points).toEqual([
      { ns: "48", score: 0.39 },
      { ns: "49", score: 0.1, via: "ПП - ДБ" },
      { ns: "52", score: 0.5 },
    ]);
    // ...but ПП↔ДБ itself keeps its gap, since the coalition cannot testify about how its
    // own two halves differed.
    expect(series.get(pairId("ПП", "ДБ"))?.points.map((p) => p.ns)).toEqual([
      "48",
      "52",
    ]);
  });

  it("orders parliaments numerically, not lexicographically", () => {
    expect(parliamentsIn(file)).toEqual(["48", "49", "52"]);
  });

  it("returns nothing for a missing file rather than throwing", () => {
    expect(buildPairSeries(undefined).size).toBe(0);
    expect(parliamentsIn(undefined)).toEqual([]);
  });
});

describe("movementFor", () => {
  const rows = movementFor(buildPairSeries(file), "52");

  it("compares against the last parliament that seated the SAME pair", () => {
    const row = rows.find((r) => r.id === pairId("ГЕРБ-СДС", "ВЪЗРАЖДАНЕ"));
    // The 49th is the immediately preceding parliament in this file and is the WRONG
    // answer: ВЪЗРАЖДАНЕ was not in it, and no coalition can stand in for it. A UI that
    // printed „спрямо предишното НС" would name a parliament the number never touched.
    expect(row?.prevNs).toBe("48");
    expect(row?.delta).toBeCloseTo(0.16, 5);
    expect(row?.prevVia).toBeNull();
  });

  it("carries the coalition on a comparison that runs through one", () => {
    const row = rows.find((r) => r.id === pairId("ГЕРБ-СДС", "ПП"));
    expect(row?.prevNs).toBe("49");
    // Not a like-for-like, and the row has to be able to say so: in the 49th this was
    // ГЕРБ-СДС against the whole ПП-ДБ coalition.
    expect(row?.prevVia).toBe("ПП - ДБ");
    expect(row?.via).toBeNull();
    expect(row?.delta).toBeCloseTo(0.49, 5);
  });

  it("ranks by the size of the move, in either direction", () => {
    // +49 for ГЕРБ-СДС↔ПП, then −43 for ГЕРБ-СДС↔ДПС: a collapse ranks with a
    // convergence of the same size, since either is the parliament's news.
    expect(rows.slice(0, 3).map((r) => r.id)).toEqual([
      pairId("ГЕРБ-СДС", "ПП"),
      pairId("ГЕРБ-СДС", "ДПС"),
      pairId("ГЕРБ-СДС", "ДБ"),
    ]);
    expect(rows[1].delta).toBeCloseTo(-0.43, 5);
  });

  it("puts pairs with no predecessor last, with a null delta", () => {
    const fresh = movementFor(buildPairSeries(file), "48");
    expect(fresh.every((r) => r.delta === null && r.prevNs === null)).toBe(
      true,
    );
  });

  it("returns nothing when no parliament is selected", () => {
    expect(movementFor(buildPairSeries(file), null)).toEqual([]);
  });
});
