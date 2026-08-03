// Where a кмет на кметство's seat resolves to.
//
// The defect: every one of the 10,721 `village_mayor` roles carried the OBSHTINA it sits in,
// so /person/rosen-rusev-a0a8lm — кмет на кметство of с. Безмер — published "Тунджа", naming a
// place he does not govern and an office (кмет на община) that belongs to somebody else.
// See docs/plans/village-mayor-attribution-v1.md §T2.

import { describe, it, expect } from "vitest";
import { buildSettlementIndex, settlementPlaceFor } from "./resolve_persons";

const rows = [
  { obshtina_code: "JAM25", name_bg: "Безмер", code: "03229" },
  { obshtina_code: "JAM25", name_bg: "Ботево", code: "05952" },
  // Two settlements share a name inside one община — 7 such pairs exist (SFO17 Елин Пелин the
  // town and the village, VID16 Орешец, SHU19 Каспичан…).
  { obshtina_code: "SFO17", name_bg: "Елин Пелин", code: "27303" },
  { obshtina_code: "SFO17", name_bg: "Елин Пелин", code: "27304" },
  // Same name, different община — must not collide.
  { obshtina_code: "DOB15", name_bg: "Безмер", code: "03294" },
];

describe("buildSettlementIndex", () => {
  it("keys on (obshtina, folded name) so a repeated name in another община is distinct", () => {
    const idx = buildSettlementIndex(rows);
    expect(idx.get("JAM25\tбезмер")).toBe("03229");
    expect(idx.get("DOB15\tбезмер")).toBe("03294");
  });

  it("marks a name that repeats WITHIN one община as ambiguous", () => {
    expect(buildSettlementIndex(rows).get("SFO17\tелин пелин")).toBeNull();
  });
});

describe("settlementPlaceFor", () => {
  const idx = buildSettlementIndex(rows);

  it("resolves the кметство to its own settlement", () => {
    expect(settlementPlaceFor(idx, "JAM25", "Безмер")).toEqual({
      placeKind: "settlement",
      placeCode: "03229",
      placeRaw: null,
    });
  });

  it("folds case and spacing the way the resolver matches names", () => {
    for (const spelling of ["безмер", "  Безмер ", "БЕЗМЕР"])
      expect(settlementPlaceFor(idx, "JAM25", spelling).placeCode).toBe(
        "03229",
      );
  });

  // The fallback IS today's behaviour, so nothing regresses on the 3.0% that do not resolve.
  it.each([
    ["an unknown settlement name", "JAM25", "Несъществуващо"],
    ["an ambiguous name", "SFO17", "Елин Пелин"],
    ["no name at all", "JAM25", null],
  ])("falls back to the obshtina for %s", (_case, obshtina, name) => {
    expect(settlementPlaceFor(idx, obshtina, name)).toEqual({
      placeKind: "obshtina",
      placeCode: obshtina,
      placeRaw: null,
    });
  });

  // A settlement place must never be minted from a place the obshtina resolver rejected —
  // `place_code` would then be an EKATTE hanging off nothing.
  it("stays place-less when there is no obshtina at all", () => {
    expect(settlementPlaceFor(idx, null, "Безмер").placeKind).toBeNull();
    expect(settlementPlaceFor(idx, "", "Безмер").placeKind).toBeNull();
  });

  // `canonicalObshtina` folds synonyms, it does not validate — an unrecognised but
  // well-formed code passes through. The invariant that matters is that a settlement is
  // never INVENTED for it: the name cannot key into the index, so the obshtina stands.
  it("never invents a settlement under an unrecognised obshtina code", () => {
    expect(settlementPlaceFor(idx, "NOPE99", "Безмер")).toEqual({
      placeKind: "obshtina",
      placeCode: "NOPE99",
      placeRaw: null,
    });
  });

  // The lookup happens under the FOLDED code: Sofia's local bundles say `SOF`, which
  // `canonicalObshtina` rewrites to `SFO_CITY`. But place_dim files Владая under S2317 and
  // Бусманци under S2414 — the РАЙОН, not the city — while the single SOF shard never names a
  // район. Without the city-wide alias key all 132 Sofia кметства resolve to nothing, the
  // largest single block of misses.
  it("resolves a Sofia кметство filed under its район", () => {
    const sofia = buildSettlementIndex([
      { obshtina_code: "S2317", name_bg: "Владая", code: "11394" },
      { obshtina_code: "S2414", name_bg: "Бусманци", code: "07106" },
    ]);
    expect(settlementPlaceFor(sofia, "SOF", "Владая").placeCode).toBe("11394");
    expect(settlementPlaceFor(sofia, "SOF", "Бусманци").placeCode).toBe(
      "07106",
    );
    // …and the район key still works for anything that does name one.
    expect(settlementPlaceFor(sofia, "S2317", "Владая").placeCode).toBe(
      "11394",
    );
  });

  // The city-wide alias must not paper over a genuine collision: two районни sharing a
  // settlement name would make "which Владая" unanswerable from the SOF shard alone. The
  // city's 58 names are unique today, and this keeps that an assumption the code checks.
  it("marks a name shared by two Sofia районни as ambiguous", () => {
    const sofia = buildSettlementIndex([
      { obshtina_code: "S2317", name_bg: "Двойно", code: "11111" },
      { obshtina_code: "S2414", name_bg: "Двойно", code: "22222" },
    ]);
    expect(settlementPlaceFor(sofia, "SOF", "Двойно").placeKind).toBe(
      "obshtina",
    );
  });

  // CIK spells the same seat "Церово" in one cycle and "кметство Церово" in another. Left
  // alone one cycle resolves and the other falls back, so PersonProfileScreen's
  // (role, placeCode) dedupe printed TWO "Кмет на кметство" rows for one job — for 69 people.
  it("strips CIK's 'кметство ' prefix so both spellings land on one seat", () => {
    expect(settlementPlaceFor(idx, "JAM25", "кметство Безмер").placeCode).toBe(
      "03229",
    );
    expect(settlementPlaceFor(idx, "JAM25", "Кметство  Безмер").placeCode).toBe(
      "03229",
    );
  });

  // An EMPTY index is the cold-bootstrap state (117 applied, db:load:place-dim:pg not yet
  // run). It must degrade to the obshtina, not to nothing.
  it("degrades to the obshtina when the dimension is unloaded", () => {
    expect(settlementPlaceFor(new Map(), "JAM25", "Безмер")).toEqual({
      placeKind: "obshtina",
      placeCode: "JAM25",
      placeRaw: null,
    });
  });
});
