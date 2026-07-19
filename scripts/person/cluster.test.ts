import { describe, it, expect } from "vitest";
import { clusterBlock, type Mention } from "./cluster";

// §7a gold-set for the resolver core. The hard invariant: a MergeGroup (→ active,
// public person) is NEVER formed without a hardId, a corroborant, or a globally-unique
// clean fold. Everything else stays separate + surfaces as a review candidate.

const base = (over: Partial<Mention>): Mention => ({
  id: "x",
  source: "tr",
  hardId: null,
  givenFold: "georgi",
  familyFold: "ivanov",
  patronymicFold: null,
  nameParts: 2,
  ambiguous: false,
  namesakeRisk: 1,
  corroborants: {},
  ...over,
});

describe("clusterBlock", () => {
  it("Tier 0 — same hardId merges as exact_id (MP seat + candidate row)", () => {
    const r = clusterBlock([
      base({
        id: "mp:1",
        source: "mp",
        hardId: "1",
        nameParts: 3,
        patronymicFold: "m",
      }),
      base({
        id: "cand:1",
        source: "candidate",
        hardId: "1",
        nameParts: 3,
        patronymicFold: "m",
      }),
    ]);
    expect(r.merges).toEqual([
      { memberIds: ["mp:1", "cand:1"], confidence: "exact_id" },
    ]);
    expect(r.reviewCandidates).toHaveLength(0);
  });

  it("Tier 1 — party AND place together corroborate a colliding fold (high)", () => {
    // The §2a 2-part↔3-part case: a bare given+family (no patronymic to conflict) merges
    // with the full-name record when party AND place both agree — the corroborant that
    // decorate_candidate_links relies on. namesakeRisk 9 excludes the Tier-2 path.
    const r = clusterBlock([
      base({
        id: "mp:2",
        source: "mp",
        nameParts: 3,
        patronymicFold: "p",
        namesakeRisk: 9,
        corroborants: { party: "ГЕРБ", place: "Пловдив" },
      }),
      base({
        id: "off:2",
        source: "official_exec",
        nameParts: 2,
        patronymicFold: null,
        namesakeRisk: 9,
        corroborants: { party: "ГЕРБ", place: "Пловдив" },
      }),
    ]);
    expect(r.merges).toEqual([
      { memberIds: ["mp:2", "off:2"], confidence: "high" },
    ]);
  });

  it("hard negative — a CONFLICTING patronymic vetoes a party+place corroborant merge", () => {
    // Real data: "Теньо Динев Тенев" vs "Теньо Желязков Тенев", both GERB, both SZR — a
    // present-on-both differing patronymic means DIFFERENT people; party+place must NOT
    // merge them. They stay separate and surface as a same-block review candidate.
    const r = clusterBlock([
      base({
        id: "cand:dinev",
        source: "candidate",
        nameParts: 3,
        patronymicFold: "dinev",
        namesakeRisk: 2,
        corroborants: { party: "gerb", place: "SZR" },
      }),
      base({
        id: "cand:zhelyazkov",
        source: "candidate",
        nameParts: 3,
        patronymicFold: "zhelyazkov",
        namesakeRisk: 2,
        corroborants: { party: "gerb", place: "SZR" },
      }),
    ]);
    expect(r.merges).toHaveLength(0);
    // Different full names (not a same-name ambiguity) → kept separate, not even review.
    expect(r.reviewCandidates).toHaveLength(0);
  });

  it("Tier 0 — a shared MP id overrides even a patronymic variance (gold key)", () => {
    // A candidacy resolved to an MP id is the same person despite a spelling variance in
    // the middle name — the gold key wins over the patronymic-conflict veto.
    const r = clusterBlock([
      base({
        id: "mp:7",
        source: "mp",
        hardId: "7",
        nameParts: 3,
        patronymicFold: "metodiev",
        namesakeRisk: 5,
      }),
      base({
        id: "cand:7",
        source: "candidate",
        hardId: "7",
        nameParts: 3,
        patronymicFold: "metodievv",
        namesakeRisk: 5,
      }),
    ]);
    expect(r.merges).toEqual([
      { memberIds: ["mp:7", "cand:7"], confidence: "exact_id" },
    ]);
  });

  it("Tier 1 — a shared company (uic) bridges a TR officer to a person on a common name", () => {
    // Bridge A: a councillor linked to company 123 + the TR sole-owner record for company
    // 123 with the same name = the councillor's own footprint. The shared uic is a STRONG,
    // name-independent corroborant, so it merges even at namesakeRisk 4.
    const r = clusterBlock([
      base({
        id: "off:c",
        source: "official_muni",
        nameParts: 3,
        patronymicFold: "koichev",
        namesakeRisk: 4,
        corroborants: { uics: ["123"] },
      }),
      base({
        id: "tr:123",
        source: "tr",
        nameParts: 3,
        patronymicFold: "koichev",
        namesakeRisk: 4,
        corroborants: { uics: ["123"] },
      }),
    ]);
    expect(r.merges).toEqual([
      { memberIds: ["off:c", "tr:123"], confidence: "high" },
    ]);
    // A DIFFERENT company (no shared uic) does NOT bridge on the common name:
    const noShare = clusterBlock([
      base({
        id: "off:c",
        source: "official_muni",
        nameParts: 3,
        patronymicFold: "koichev",
        namesakeRisk: 4,
        corroborants: { uics: ["123"] },
      }),
      base({
        id: "tr:999",
        source: "tr",
        nameParts: 3,
        patronymicFold: "koichev",
        namesakeRisk: 4,
        corroborants: { uics: ["999"] },
      }),
    ]);
    expect(noShare.merges).toHaveLength(0);
  });

  it("INVARIANT — party ALONE never merges; an identical common full name flags review", () => {
    const r = clusterBlock([
      base({
        id: "a",
        nameParts: 3,
        patronymicFold: "p",
        namesakeRisk: 9,
        corroborants: { party: "ГЕРБ" },
      }),
      base({
        id: "b",
        nameParts: 3,
        patronymicFold: "p",
        namesakeRisk: 9,
        corroborants: { party: "ГЕРБ" },
      }),
    ]);
    expect(r.merges).toHaveLength(0); // party alone is too weak
    // identical full name (same patronymic), common (namesake 9) -> review, not merge
    expect(r.reviewCandidates).toEqual([{ memberIds: ["a", "b"] }]);
  });

  it("INVARIANT — an identical full name merges ONLY when globally unique (namesake<=1)", () => {
    const unique = clusterBlock([
      base({
        id: "a",
        nameParts: 3,
        patronymicFold: "petrov",
        namesakeRisk: 1,
      }),
      base({
        id: "b",
        nameParts: 3,
        patronymicFold: "petrov",
        namesakeRisk: 1,
      }),
    ]);
    expect(unique.merges).toEqual([
      { memberIds: ["a", "b"], confidence: "high" },
    ]);

    // Same identical full name but COMMON (148 namesakes) -> never merged on name alone.
    const common = clusterBlock([
      base({
        id: "a",
        nameParts: 3,
        patronymicFold: "petrov",
        namesakeRisk: 148,
      }),
      base({
        id: "b",
        nameParts: 3,
        patronymicFold: "petrov",
        namesakeRisk: 148,
      }),
    ]);
    expect(common.merges).toHaveLength(0);
    expect(common.reviewCandidates).toEqual([{ memberIds: ["a", "b"] }]);
  });

  it("Tier 2 — a globally-unique clean 3-part fold merges the whole block as high", () => {
    const r = clusterBlock([
      base({
        id: "mag:x",
        source: "magistrate",
        nameParts: 3,
        patronymicFold: "a",
        namesakeRisk: 1,
      }),
      base({
        id: "tr:x",
        source: "tr",
        nameParts: 3,
        patronymicFold: "a",
        namesakeRisk: 1,
      }),
    ]);
    expect(r.merges).toEqual([
      { memberIds: ["mag:x", "tr:x"], confidence: "high" },
    ]);
    expect(r.reviewCandidates).toHaveLength(0);
  });

  it("INVARIANT — two colliding 2-part namesakes never merge (zero false public merge)", () => {
    const r = clusterBlock([
      base({ id: "don:1", source: "donor", namesakeRisk: 40 }),
      base({ id: "tr:1", source: "tr", namesakeRisk: 40 }),
    ]);
    expect(r.merges).toHaveLength(0); // the donor-blocker case: no bridge
    expect(r.reviewCandidates).toEqual([{ memberIds: ["don:1", "tr:1"] }]);
  });

  it("INVARIANT — an ambiguous (4+ token) name never merges on the name alone", () => {
    // Identical full name, globally unique (namesake 1), but AMBIGUOUS (guessed family
    // boundary) — excluded from the Tier-2 unique-name merge, so it stays for review.
    const r = clusterBlock([
      base({
        id: "a",
        nameParts: 3,
        ambiguous: true,
        patronymicFold: "z",
        namesakeRisk: 1,
      }),
      base({
        id: "b",
        nameParts: 3,
        ambiguous: true,
        patronymicFold: "z",
        namesakeRisk: 1,
      }),
    ]);
    expect(r.merges).toHaveLength(0);
    // …but a STRONG corroborant (shared company) still merges it:
    const r2 = clusterBlock([
      base({
        id: "a",
        nameParts: 3,
        ambiguous: true,
        patronymicFold: "z",
        namesakeRisk: 1,
        corroborants: { uics: ["123"] },
      }),
      base({
        id: "b",
        nameParts: 3,
        ambiguous: true,
        patronymicFold: "z",
        namesakeRisk: 1,
        corroborants: { uics: ["123"] },
      }),
    ]);
    expect(r2.merges).toHaveLength(1);
  });

  it("hard negative — two distinct hard-keyed people stay separate; a floating singleton flags review", () => {
    const r = clusterBlock([
      base({
        id: "mp:10",
        source: "mp",
        hardId: "10",
        nameParts: 3,
        patronymicFold: "a",
        namesakeRisk: 8,
        corroborants: { party: "A" },
      }),
      base({
        id: "mp:20",
        source: "mp",
        hardId: "20",
        nameParts: 3,
        patronymicFold: "b",
        namesakeRisk: 8,
        corroborants: { party: "B" },
      }),
      base({ id: "tr:z", source: "tr", nameParts: 2, namesakeRisk: 8 }),
    ]);
    // The two MPs are distinct (different hardId, different party) — not merged.
    expect(r.merges).toHaveLength(0);
    // The floating TR officer could be either -> one review candidate listing all three.
    expect(r.reviewCandidates).toHaveLength(1);
    expect(r.reviewCandidates[0].memberIds.sort()).toEqual([
      "mp:10",
      "mp:20",
      "tr:z",
    ]);
  });

  it("a lone clean mention is its own person (no merge, no review)", () => {
    const r = clusterBlock([
      base({ id: "solo", nameParts: 3, patronymicFold: "a", namesakeRisk: 1 }),
    ]);
    expect(r.merges).toHaveLength(0);
    expect(r.reviewCandidates).toHaveLength(0);
  });
});
