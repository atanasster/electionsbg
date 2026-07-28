// The raw-vs-resolved decision in judicialPlaceFor(), covered without a database.
//
// This is the only one of the three typed-place builders that makes a judgement: whether a
// free-text ИВСС court name folds onto a real judicial_body, or is kept verbatim in
// place_raw. Both outcomes are load-bearing and both are silent when wrong — a bad fold puts
// the WRONG court on a named magistrate's public profile, and a lost fallback blanks a badge
// — so the branch is pinned here rather than only through the live-DB gate (which skips
// wherever Postgres is absent, i.e. CI).

import { describe, it, expect } from "vitest";
import { judicialPlaceFor } from "./resolve_persons";
import { foldJudicialName } from "../judiciary/judicialBodies";

// A stand-in dictionary keyed the way the real one is: by folded alias.
const dict = new Map<string, { code: string }>([
  [foldJudicialName("Софийски районен съд"), { code: "srs" }],
  [foldJudicialName("Върховен касационен съд"), { code: "vks" }],
]);

describe("judicialPlaceFor", () => {
  it("resolves a known court to its body code and keeps no raw text", () => {
    expect(judicialPlaceFor(dict, "Софийски районен съд")).toEqual({
      placeKind: "judicial",
      placeCode: "srs",
      placeRaw: null,
    });
  });

  it("resolves through the fold, not by exact string match", () => {
    // The declaration form is free text; casing and spacing vary run to run. If this ever
    // regresses to an exact match, thousands of magistrates silently lose their court.
    const r = judicialPlaceFor(dict, "  СОФИЙСКИ  РАЙОНЕН   СЪД ");
    expect(r.placeCode).toBe("srs");
  });

  it("keeps the declaration's own words when nothing resolves", () => {
    // "Роайонен съд - Пловдив" is a real typo in the corpus. We refuse to guess a body for
    // it — a wrong court is a misstatement about a named person — but the source's text is
    // still the honest thing to show.
    expect(judicialPlaceFor(dict, "Роайонен съд - Пловдив")).toEqual({
      placeKind: null,
      placeCode: null,
      placeRaw: "Роайонен съд - Пловдив",
    });
  });

  it("never carries raw text alongside a resolved code", () => {
    // The invariant 115's CHECK enforces in the database, asserted at the producer too.
    for (const input of ["Софийски районен съд", "Върховен касационен съд"]) {
      const r = judicialPlaceFor(dict, input);
      expect(r.placeCode).not.toBeNull();
      expect(r.placeRaw).toBeNull();
    }
  });

  it("treats a missing or whitespace-only court as no place at all", () => {
    const empty = { placeKind: null, placeCode: null, placeRaw: null };
    expect(judicialPlaceFor(dict, null)).toEqual(empty);
    expect(judicialPlaceFor(dict, "")).toEqual(empty);
    // Whitespace-only must not become an empty-string badge.
    expect(judicialPlaceFor(dict, "   ")).toEqual(empty);
  });
});
