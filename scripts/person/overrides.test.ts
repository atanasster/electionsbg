// Hermetic unit tests for the human-override tier (scripts/person/overrides.ts). No DB — the
// pure applier over synthetic groups/mentions, so the merge/split logic is pinned fast on
// every commit. The end-to-end PG round-trip is in scripts/db/tests/person_override.data.test.ts.

import { describe, it, expect } from "vitest";
import {
  parseOverrides,
  applyOverrides,
  EMPTY_OVERRIDES,
  type OvMention,
  type OGroup,
} from "./overrides";

// Two same-name candidacies that matchMp() bound to the SAME mp id — one correctly (the real
// MP), one wrongly (a different person who shares all three names). Both carry hardId mp:42 and
// the same fold, so the gold union collapses them onto one person. This is the mis-merge a name
// fold cannot undo (both sides share the fold), and the ref-split exists for.
const FOLD = "monika georgieva vasileva";
const mp: OvMention = {
  id: "mp:42",
  source: "mp",
  ref: "42",
  hardId: "mp:42",
  nameFold: FOLD,
};
const rightCand: OvMention = {
  id: "candidate:2021_04_04:c-1-monika",
  source: "candidate",
  ref: "2021_04_04:c-1-monika",
  hardId: "mp:42",
  nameFold: FOLD,
};
const wrongCand: OvMention = {
  id: "candidate:2024_06_09:c-26-monika",
  source: "candidate",
  ref: "2024_06_09:c-26-monika",
  hardId: "mp:42", // WRONG — matchMp() mis-bound a different Monika to this MP
  nameFold: FOLD,
};
// The gold union has already collapsed all three onto one exact_id person.
const misMerged: OGroup[] = [
  { ids: [mp.id, rightCand.id, wrongCand.id], confidence: "exact_id" },
];
const all = [mp, rightCand, wrongCand];

describe("parseOverrides", () => {
  it("routes a ref-bearing split to refSplits and a fold pair to fold ops", () => {
    const p = parseOverrides([
      { kind: "split", fold_a: null, fold_b: null, ref_a: "r1", ref_b: "r2" },
      { kind: "merge", fold_a: "a", fold_b: "b", ref_a: null, ref_b: null },
      { kind: "split", fold_a: "c", fold_b: "d", ref_a: null, ref_b: null },
    ]);
    expect([...p.refSplits].sort()).toEqual(["r1", "r2"]);
    expect(p.merges).toEqual([["a", "b"]]);
    expect(p.foldSplits).toEqual([["c", "d"]]);
  });
});

describe("applyOverrides", () => {
  it("is an exact no-op with no overrides", () => {
    expect(applyOverrides(misMerged, all, EMPTY_OVERRIDES)).toBe(misMerged);
  });

  it("ref-split isolates the wrong candidacy, vetoing the Tier-0 gold union", () => {
    const out = applyOverrides(misMerged, all, {
      merges: [],
      foldSplits: [],
      refSplits: new Set(["2024_06_09:c-26-monika"]), // the bare source-native ref
    });
    // The wrong candidacy is its own person; the MP keeps its real candidacy.
    const wrong = out.find((g) => g.ids.includes(wrongCand.id))!;
    expect(wrong.ids).toEqual([wrongCand.id]);
    const kept = out.find((g) => g.ids.includes(mp.id))!;
    expect(kept.ids.sort()).toEqual([mp.id, rightCand.id].sort());
    // The wrong candidacy no longer shares an mp person, so it never renders as that MP.
    expect(
      out.some((g) => g.ids.includes(mp.id) && g.ids.includes(wrongCand.id)),
    ).toBe(false);
  });

  it("matches a ref-split by mention id or source-qualified ref too", () => {
    for (const key of [
      "candidate:2024_06_09:c-26-monika", // == both the mention id and {source}:{ref}
    ]) {
      const out = applyOverrides(misMerged, all, {
        merges: [],
        foldSplits: [],
        refSplits: new Set([key]),
      });
      expect(out.find((g) => g.ids.includes(wrongCand.id))!.ids).toEqual([
        wrongCand.id,
      ]);
    }
  });

  it("fold-merge unions two persons the resolver left in different blocks", () => {
    const a: OvMention = {
      id: "mp:1",
      source: "mp",
      ref: "1",
      hardId: "mp:1",
      nameFold: "galya stoyanova zhelyazkova",
    };
    const b: OvMention = {
      id: "mp:2",
      source: "mp",
      ref: "2",
      hardId: "mp:2",
      nameFold: "galya stoyanova vasileva",
    };
    const groups: OGroup[] = [
      { ids: [a.id], confidence: "high" },
      { ids: [b.id], confidence: "high" },
    ];
    const out = applyOverrides(groups, [a, b], {
      merges: [["galya stoyanova zhelyazkova", "galya stoyanova vasileva"]],
      foldSplits: [],
      refSplits: new Set(),
    });
    expect(out).toHaveLength(1);
    expect(out[0].ids.sort()).toEqual([a.id, b.id].sort());
    // Two distinct hard ids, no shared one, but merged by a human → manual.
    expect(out[0].confidence).toBe("manual");
  });

  it("fold-split peels fold_b out of a component that also holds fold_a", () => {
    const a: OvMention = {
      id: "off:x",
      source: "official_exec",
      ref: "x",
      hardId: null,
      nameFold: "ivan petrov ivanov",
    };
    const b: OvMention = {
      id: "off:y",
      source: "official_exec",
      ref: "y",
      hardId: null,
      nameFold: "ivan stoyanov ivanov",
    };
    // Pretend a bad automatic union put both in one component.
    const groups: OGroup[] = [{ ids: [a.id, b.id], confidence: "high" }];
    const out = applyOverrides(groups, [a, b], {
      merges: [],
      foldSplits: [["ivan petrov ivanov", "ivan stoyanov ivanov"]],
      refSplits: new Set(),
    });
    expect(out).toHaveLength(2);
    expect(out.map((g) => g.ids)).toContainEqual([b.id]);
  });

  it("split wins over a merge on the same pair", () => {
    const out = applyOverrides(misMerged, all, {
      merges: [[FOLD, FOLD]],
      foldSplits: [],
      refSplits: new Set(["2024_06_09:c-26-monika"]),
    });
    expect(out.find((g) => g.ids.includes(wrongCand.id))!.ids).toEqual([
      wrongCand.id,
    ]);
  });
});
