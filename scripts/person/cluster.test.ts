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
    expect(r.reviewCandidates).toEqual([
      { memberIds: ["a", "b"], reason: "identical_fullname" },
    ]);
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
    expect(common.reviewCandidates).toEqual([
      { memberIds: ["a", "b"], reason: "identical_fullname" },
    ]);
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
    expect(r.reviewCandidates).toEqual([
      { memberIds: ["don:1", "tr:1"], reason: "twopart_block" },
    ]);
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

  // The party-office rule — the one corroborant that merges WITHOUT a place, because a
  // party chair has an institution and no oblast. Modelled on Слави Трифонов: the ИТН
  // party officer and the ИТН candidacy of "Станислав Тодоров Трифонов", namesakeRisk 5,
  // no shared company, no birth date on the register side.
  it("Tier 1 — a party office + an identical full name + the same party merge (no place)", () => {
    const r = clusterBlock([
      base({
        id: "off:itn",
        source: "official_exec",
        nameParts: 3,
        patronymicFold: "todorov",
        namesakeRisk: 5,
        corroborants: { party: "p_0", partyOffice: true },
      }),
      base({
        id: "cand:itn",
        source: "candidate",
        nameParts: 3,
        patronymicFold: "todorov",
        namesakeRisk: 5,
        corroborants: { party: "p_0", place: "Плевен" },
      }),
    ]);
    expect(r.merges).toEqual([
      { memberIds: ["off:itn", "cand:itn"], confidence: "high" },
    ]);
  });

  it("party office — a MASS name is never merged on the party alone", () => {
    // "Георги Иванов Георгиев" scores 198. A party the size of ГЕРБ has many, so the
    // officer and the councillor of that name are not one person in any expected sense.
    const r = clusterBlock([
      base({
        id: "off:mass",
        source: "official_exec",
        nameParts: 3,
        patronymicFold: "ivanov",
        namesakeRisk: 198,
        corroborants: { party: "p_1", partyOffice: true },
      }),
      base({
        id: "local:mass",
        source: "local",
        nameParts: 3,
        patronymicFold: "ivanov",
        namesakeRisk: 198,
        corroborants: { party: "p_1", place: "Русе" },
      }),
    ]);
    expect(r.merges).toHaveLength(0);
    expect(r.reviewCandidates).toHaveLength(1);
  });

  it("party office — a DIFFERENT party, or no office on either side, does not merge", () => {
    const officer = {
      id: "off:x",
      source: "official_exec",
      nameParts: 3 as const,
      patronymicFold: "p",
      namesakeRisk: 5,
    };
    // Same full name, both in the party — but neither mention is a party OFFICE, and
    // without a place weak-both cannot fire either.
    expect(
      clusterBlock([
        base({ ...officer, corroborants: { party: "p_0" } }),
        base({
          ...officer,
          id: "cand:x",
          source: "candidate",
          corroborants: { party: "p_0" },
        }),
      ]).merges,
    ).toHaveLength(0);
    // An office, but the two name different parties.
    expect(
      clusterBlock([
        base({ ...officer, corroborants: { party: "p_0", partyOffice: true } }),
        base({
          ...officer,
          id: "cand:x",
          source: "candidate",
          corroborants: { party: "p_9", place: "Плевен" },
        }),
      ]).merges,
    ).toHaveLength(0);
    // An office and the same party, but the patronymic differs — a different full name,
    // which is the whole basis of the claim.
    expect(
      clusterBlock([
        base({ ...officer, corroborants: { party: "p_0", partyOffice: true } }),
        base({
          ...officer,
          id: "cand:x",
          source: "candidate",
          patronymicFold: "q",
          corroborants: { party: "p_0", place: "Плевен" },
        }),
      ]).merges,
    ).toHaveLength(0);
    // An office and the same party, but the officer's name is a 2-part source name — the
    // block key alone does not pin a full name.
    expect(
      clusterBlock([
        base({
          ...officer,
          nameParts: 2,
          patronymicFold: null,
          corroborants: { party: "p_0", partyOffice: true },
        }),
        base({
          ...officer,
          id: "cand:x",
          source: "candidate",
          corroborants: { party: "p_0", place: "Плевен" },
        }),
      ]).merges,
    ).toHaveLength(0);
  });

  describe("Tier 1 — sameLocalSeat (local continuity across cycles)", () => {
    // A кмет на кметство elected by an инициативен комитет has NO party, so `weakBoth`
    // (party AND place) can never fire and only a globally-unique name saved him. That is
    // how 640 re-elected officeholders came to hold one person record per term.
    // docs/plans/local-person-links-v2.md §A3.
    const seat = "village_mayor\tsettlement:87374";
    const term = (cycle: string, over: Partial<Mention> = {}): Mention =>
      base({
        id: `local:${cycle}`,
        source: "local",
        nameParts: 3,
        patronymicFold: "gospodinov",
        // A colliding fold — the point of the rule is that it works where Tier 2 cannot.
        namesakeRisk: 7,
        corroborants: { localSeat: seat, localCycle: cycle },
        ...over,
      });

    it("merges the same seat held in two different cycles", () => {
      const r = clusterBlock([term("2019_10_27_mi"), term("2023_10_29_mi")]);
      expect(r.merges).toEqual([
        {
          memberIds: ["local:2019_10_27_mi", "local:2023_10_29_mi"],
          confidence: "high",
        },
      ]);
      expect(r.reviewCandidates).toHaveLength(0);
    });

    it("does NOT merge two holders of the same seat in the SAME cycle", () => {
      // One village has one mayor per cycle, so this is two same-named people — the
      // genuinely ambiguous case (3 of the 640 groups). It must reach a human.
      const r = clusterBlock([
        term("2023_10_29_mi", { id: "local:a" }),
        term("2023_10_29_mi", { id: "local:b" }),
      ]);
      expect(r.merges).toHaveLength(0);
      expect(r.reviewCandidates).toEqual([
        { memberIds: ["local:a", "local:b"], reason: "identical_fullname" },
      ]);
    });

    it("a contested term is not laundered through a third cycle", () => {
      // The transitivity trap: 2019–2023a and 2019–2023b are each legal pairs, so a
      // PAIRWISE same-cycle veto lets union-find fuse all three without ever comparing the
      // two 2023 rows — and because reviewCandidates reads the FINAL components, the one
      // root would also erase the flag meant to carry the case to a human. Both halves are
      // asserted here. Live shape: Валери Иванов Василев, VID09.
      const r = clusterBlock([
        term("2019_10_27_mi", { id: "local:old" }),
        term("2023_10_29_mi", { id: "local:a" }),
        term("2023_10_29_mi", { id: "local:b" }),
      ]);
      expect(r.merges).toHaveLength(0);
      expect(r.reviewCandidates).toEqual([
        {
          memberIds: ["local:old", "local:a", "local:b"],
          reason: "identical_fullname",
        },
      ]);
    });

    it("a contest in one cycle does not block an unrelated seat in the block", () => {
      // The exclusion is per seat-TERM, not per block: two same-named councillors on one
      // 2023 council must not also cost the village mayor down the road his continuity.
      const other = "village_mayor\tsettlement:00123";
      const r = clusterBlock([
        term("2023_10_29_mi", { id: "local:a" }),
        term("2023_10_29_mi", { id: "local:b" }),
        term("2019_10_27_mi", {
          id: "local:v19",
          corroborants: { localSeat: other, localCycle: "2019_10_27_mi" },
        }),
        term("2023_10_29_mi", {
          id: "local:v23",
          corroborants: { localSeat: other, localCycle: "2023_10_29_mi" },
        }),
      ]);
      expect(r.merges).toEqual([
        { memberIds: ["local:v19", "local:v23"], confidence: "high" },
      ]);
    });

    it("does NOT merge different seats, or a seat against no seat", () => {
      expect(
        clusterBlock([
          term("2019_10_27_mi"),
          term("2023_10_29_mi", {
            corroborants: {
              localSeat: "village_mayor\tsettlement:00000",
              localCycle: "2023_10_29_mi",
            },
          }),
        ]).merges,
      ).toHaveLength(0);
      // Same place, different office — a mayor and a councillor are not one seat.
      expect(
        clusterBlock([
          term("2019_10_27_mi"),
          term("2023_10_29_mi", {
            corroborants: {
              localSeat: "councillor\tsettlement:87374",
              localCycle: "2023_10_29_mi",
            },
          }),
        ]).merges,
      ).toHaveLength(0);
      // A mention with no seat at all (any non-local source) never corroborates.
      expect(
        clusterBlock([
          term("2019_10_27_mi"),
          base({
            id: "tr:1",
            nameParts: 3,
            patronymicFold: "gospodinov",
            namesakeRisk: 7,
          }),
        ]).merges,
      ).toHaveLength(0);
    });

    it("keeps the name guards — patronymic, 2-part, ambiguous, namesake cap", () => {
      const other = (over: Partial<Mention>) =>
        term("2023_10_29_mi", { id: "local:b", ...over });
      // A conflicting patronymic is a hard negative that outranks any corroborant.
      expect(
        clusterBlock([
          term("2019_10_27_mi"),
          other({ patronymicFold: "petrov" }),
        ]).merges,
      ).toHaveLength(0);
      // A 2-part name does not pin a full name, so the seat cannot carry the merge.
      expect(
        clusterBlock([
          term("2019_10_27_mi", { nameParts: 2, patronymicFold: null }),
          other({ nameParts: 2, patronymicFold: null }),
        ]).merges,
      ).toHaveLength(0);
      // A 4+ token guess is not a name we can stand behind.
      expect(
        clusterBlock([term("2019_10_27_mi"), other({ ambiguous: true })])
          .merges,
      ).toHaveLength(0);
    });

    it("ignores the namesake cap on an EXCLUSIVE seat, honours it on a council", () => {
      // One село has one кмет на кметство, so the SEAT identifies and a mass name does not
      // matter — this is the plan's symptom #3 (Георги Стоянов Георгиев, кмет на Тунджа
      // 2007-2019 on four records at namesakeRisk 39, blocked by nothing but the cap).
      expect(
        clusterBlock([
          term("2019_10_27_mi", { namesakeRisk: 198 }),
          term("2023_10_29_mi", { id: "local:b", namesakeRisk: 198 }),
        ]).merges,
      ).toHaveLength(1);
      // Same for a кмет на община, whose seat key is built off the ref.
      const mayorSeat = "mayor\tJAM25:mayor";
      expect(
        clusterBlock([
          term("2007_10_28_mi", {
            namesakeRisk: 39,
            corroborants: { localSeat: mayorSeat, localCycle: "2007_10_28_mi" },
          }),
          term("2011_10_23_mi", {
            id: "local:b",
            namesakeRisk: 39,
            corroborants: { localSeat: mayorSeat, localCycle: "2011_10_23_mi" },
          }),
        ]).merges,
      ).toHaveLength(1);
      // A COUNCIL is not exclusive — it seats dozens — so the cap still applies there.
      const council = "councillor\tVID09";
      const councillor = (cycle: string, id: string) =>
        term(cycle, {
          id,
          namesakeRisk: 198,
          corroborants: { localSeat: council, localCycle: cycle },
        });
      expect(
        clusterBlock([
          councillor("2019_10_27_mi", "local:a"),
          councillor("2023_10_29_mi", "local:b"),
        ]).merges,
      ).toHaveLength(0);
      // ...and under the cap it merges, so the guard above is the cap and not the key.
      expect(
        clusterBlock([
          { ...councillor("2019_10_27_mi", "local:a"), namesakeRisk: 4 },
          { ...councillor("2023_10_29_mi", "local:b"), namesakeRisk: 4 },
        ]).merges,
      ).toHaveLength(1);
    });

    it("keeps every other guard on an exclusive seat, cap or no cap", () => {
      // Dropping the cap must not turn the exclusive seat into a free pass: a conflicting
      // patronymic, a 2-part name and a same-cycle contest all still refuse.
      const hi = { namesakeRisk: 198 };
      expect(
        clusterBlock([
          term("2019_10_27_mi", hi),
          term("2023_10_29_mi", {
            id: "local:b",
            ...hi,
            patronymicFold: "petrov",
          }),
        ]).merges,
      ).toHaveLength(0);
      expect(
        clusterBlock([
          term("2019_10_27_mi", { ...hi, nameParts: 2, patronymicFold: null }),
          term("2023_10_29_mi", {
            id: "local:b",
            ...hi,
            nameParts: 2,
            patronymicFold: null,
          }),
        ]).merges,
      ).toHaveLength(0);
      expect(
        clusterBlock([
          term("2023_10_29_mi", { id: "local:a", ...hi }),
          term("2023_10_29_mi", { id: "local:b", ...hi }),
        ]).merges,
      ).toHaveLength(0);
    });

    it("chains three terms of one seat into a single person", () => {
      const r = clusterBlock([
        term("2011_10_23_mi"),
        term("2015_10_25_mi"),
        term("2023_10_29_mi"),
      ]);
      expect(r.merges).toHaveLength(1);
      expect(r.merges[0].memberIds).toHaveLength(3);
      expect(r.merges[0].confidence).toBe("high");
    });
  });

  it("a lone clean mention is its own person (no merge, no review)", () => {
    const r = clusterBlock([
      base({ id: "solo", nameParts: 3, patronymicFold: "a", namesakeRisk: 1 }),
    ]);
    expect(r.merges).toHaveLength(0);
    expect(r.reviewCandidates).toHaveLength(0);
  });

  // Tier 2b — the people-counted arm. Every case below has `namesakeRisk: 5`, i.e. Tier 2a
  // refuses all of them, so any merge here is 2b's and nothing else's.
  describe("Tier 2b — unique in both registers", () => {
    // The population this arm exists for: an MP and the officials slug their ministerial
    // declarations were filed under. Same full name, no shared corroborant (a minister has
    // an institution, not an oblast, so party+place can never fire) and a namesakeRisk that
    // counts the man's own two companies.
    const mp = (over: Partial<Mention> = {}) =>
      base({
        id: "mp:1",
        source: "mp",
        nameParts: 3,
        patronymicFold: "angelov",
        namesakeRisk: 5,
        registerPeople: 1,
        mpPeople: 1,
        ...over,
      });
    const official = (over: Partial<Mention> = {}) =>
      base({
        id: "official:x",
        source: "official_exec",
        nameParts: 3,
        patronymicFold: "angelov",
        namesakeRisk: 5,
        registerPeople: 1,
        mpPeople: 1,
        ...over,
      });

    it("merges an MP with the officials slug holding their declarations", () => {
      const r = clusterBlock([mp(), official()]);
      expect(r.merges).toHaveLength(1);
      expect(r.merges[0].memberIds.sort()).toEqual(["mp:1", "official:x"]);
      // No gold key was involved — this is a name-plus-uniqueness merge, not exact_id.
      expect(r.merges[0].confidence).toBe("high");
      expect(r.reviewCandidates).toHaveLength(0);
    });

    it("refuses when the register knows TWO declarants of the name", () => {
      const r = clusterBlock([
        mp({ registerPeople: 2 }),
        official({ registerPeople: 2 }),
      ]);
      expect(r.merges).toHaveLength(0);
      expect(r.reviewCandidates[0].reason).toBe("identical_fullname");
    });

    // The one that separates "unique" from "unknown". 0 is the register never having seen
    // the name, and a `<= 1` reading would merge here — on two people nothing has ever
    // attested. Measured, that reading newly merges 1,469 folds with no register presence.
    it("refuses when the register has never seen the name (0, not 1)", () => {
      const r = clusterBlock([
        mp({ registerPeople: 0, mpPeople: 0, source: "local" }),
        official({ registerPeople: 0, mpPeople: 0, source: "local" }),
      ]);
      expect(r.merges).toHaveLength(0);
    });

    it("refuses when the parliament roster holds two MPs of the name", () => {
      const r = clusterBlock([mp({ mpPeople: 2 }), official({ mpPeople: 2 })]);
      expect(r.merges).toHaveLength(0);
    });

    // A TR officer row is a name on a company filing with no person key behind it, so
    // neither count can vouch for it. Merging one into a named official is the accusation
    // the whole file exists to prevent; Bridge B attaches a public person's own companies
    // under its own guard instead.
    it("refuses to sweep a TR mention in, however unique the name", () => {
      const r = clusterBlock([
        official(),
        base({
          id: "tr:123",
          source: "tr",
          nameParts: 3,
          patronymicFold: "angelov",
          namesakeRisk: 5,
          registerPeople: 1,
          mpPeople: 1,
        }),
      ]);
      expect(r.merges).toHaveLength(0);
    });

    // The conservative variant. A third identity on the fold is a third decision, and
    // merging two of three would be picking one of them with no evidence for the choice.
    it("refuses a fold carrying a third identity", () => {
      const r = clusterBlock([
        mp(),
        official(),
        official({ id: "official:y" }),
      ]);
      expect(r.merges).toHaveLength(0);
      expect(r.reviewCandidates[0].reason).toBe("identical_fullname");
    });

    // …but two components is what it asks for, not two mentions: a pair already merged by
    // an earlier tier still counts as one, so a gold-keyed pair plus a stray official is a
    // legal 2-component group.
    it("counts components, not mentions — a Tier-0 pair is one identity", () => {
      const r = clusterBlock([
        mp({ hardId: "1" }),
        official({ id: "official:gold", hardId: "1" }),
        official(),
      ]);
      expect(r.merges).toHaveLength(1);
      expect(r.merges[0].memberIds.sort()).toEqual([
        "mp:1",
        "official:gold",
        "official:x",
      ]);
      // A Tier-0 edge formed part of it, so the group keeps the stronger confidence.
      expect(r.merges[0].confidence).toBe("exact_id");
    });

    // The licence's scope, and the condition the first cut of this arm was missing.
    // `registerPeople = 1` means "one person of this name has ever FILED", which is
    // evidence about the register and about nothing outside it. A ЦИК candidate row or a
    // council roll carries no filing, so a namesake who never declared is invisible to the
    // count — and merging on it produced 145 unlicensed cross-source merges on the real
    // corpus, „Александър Иванов Иванов" among them.
    it.each(["candidate", "local", "tr", "donor", "magistrate", "ngo"])(
      "refuses a %s-only identity — outside both counts, so neither vouches for it",
      (source) => {
        const r = clusterBlock([
          official(),
          base({
            id: `${source}:1`,
            source,
            nameParts: 3,
            patronymicFold: "angelov",
            namesakeRisk: 5,
            registerPeople: 1,
            mpPeople: 1,
          }),
        ]);
        expect(r.merges).toHaveLength(0);
      },
    );

    // …but the anchor is per IDENTITY, not per row. Nearly every MP also holds candidacies,
    // gold-keyed to the same mp id by Tier 0, and those rows add no unvouched-for identity
    // — they are already proven to be that MP. Requiring every mention to be counted took
    // this arm from 42 merged pairs to 2 on the real corpus.
    it("allows an uncounted mention that a gold key already put in the component", () => {
      const r = clusterBlock([
        mp({ hardId: "1" }),
        base({
          id: "cand:1",
          source: "candidate",
          hardId: "1",
          nameParts: 3,
          patronymicFold: "angelov",
          namesakeRisk: 5,
          registerPeople: 1,
          mpPeople: 1,
        }),
        official(),
      ]);
      expect(r.merges).toHaveLength(1);
      expect(r.merges[0].memberIds.sort()).toEqual([
        "cand:1",
        "mp:1",
        "official:x",
      ]);
    });

    // …and the counted sources are read from the ONE set that already answers "whose ref is
    // a declaration slug", so a dedicated source cannot fall out of the licence the way
    // `president` / `mep` / `diplomat` once fell out of `startsWith("official")`.
    it.each(["official_exec", "official_muni", "president", "mep", "diplomat"])(
      "merges an MP with a %s role — a counted source",
      (source) => {
        const r = clusterBlock([mp(), official({ source })]);
        expect(r.merges).toHaveLength(1);
      },
    );

    it("still refuses a differing patronymic — 2b never crosses full names", () => {
      const r = clusterBlock([mp(), official({ patronymicFold: "petrov" })]);
      expect(r.merges).toHaveLength(0);
    });

    it("still refuses a 2-part or ambiguous name", () => {
      expect(
        clusterBlock([mp(), official({ nameParts: 2, patronymicFold: null })])
          .merges,
      ).toHaveLength(0);
      expect(
        clusterBlock([mp(), official({ ambiguous: true })]).merges,
      ).toHaveLength(0);
    });

    // The mass-name backstop. 2b's licence is weakest exactly where the name is commonest,
    // because the register only knows people who have FILED — on „Владимир Иванов Иванов"
    // (44 companies) one declarant of the name says very little about whether the MP is him.
    // Every other name-based rule in cluster.ts carries this cap; 2b shipped without one and
    // a review caught live merges up to namesakeRisk 70.
    it("refuses a mass name even when both registers call it unique", () => {
      expect(
        clusterBlock([mp({ namesakeRisk: 44 }), official({ namesakeRisk: 44 })])
          .merges,
      ).toHaveLength(0);
      // …and still fires just under the cap, so the threshold is doing the discriminating
      // rather than the rule being off entirely.
      expect(
        clusterBlock([mp({ namesakeRisk: 12 }), official({ namesakeRisk: 12 })])
          .merges,
      ).toHaveLength(1);
    });

    // 2b's own unions change what `find()` returns, and patronymic groups can share a
    // component, so reading the component split live made the tier depend on mention order —
    // which descends from unordered SQL. Public identity has to be reproducible.
    it("is order-independent", () => {
      const block = [
        mp({ hardId: "1" }),
        base({
          id: "cand:1",
          source: "candidate",
          hardId: "1",
          nameParts: 3,
          patronymicFold: "angelov",
          namesakeRisk: 5,
          registerPeople: 1,
          mpPeople: 1,
        }),
        official(),
        base({
          id: "official:other",
          source: "official_muni",
          nameParts: 3,
          patronymicFold: "petrov",
          namesakeRisk: 5,
          registerPeople: 1,
          mpPeople: 1,
        }),
      ];
      const norm = (ms: { memberIds: string[] }[]) =>
        ms
          .map((m) => [...m.memberIds].sort().join("|"))
          .sort()
          .join(" // ");
      expect(norm(clusterBlock([...block].reverse()).merges)).toBe(
        norm(clusterBlock(block).merges),
      );
    });

    // Absent fields default to "not attested", so every pre-existing caller and fixture
    // keeps exactly its old behaviour.
    it("is inert when the counts are absent", () => {
      const r = clusterBlock([
        base({
          id: "a",
          source: "official_exec",
          nameParts: 3,
          patronymicFold: "angelov",
          namesakeRisk: 5,
        }),
        base({
          id: "b",
          source: "official_muni",
          nameParts: 3,
          patronymicFold: "angelov",
          namesakeRisk: 5,
        }),
      ]);
      expect(r.merges).toHaveLength(0);
    });
  });
});
