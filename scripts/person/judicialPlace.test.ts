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

  it("matches the raw source name before folding", () => {
    // The loader keys judicial_body_alias with the VOCABULARY-FUL fold and there is no
    // vocabulary here, so the one construct that needs it — a glued abbreviation — folds
    // to a different key on this side and misses a body resolved fine at load time.
    // judicial_body_source_name holds the un-folded string, which needs no vocabulary.
    expect(foldJudicialName("РПКюстендил")).toBe("РПКЮСТЕНДИЛ");
    const raw = new Map([["РПКюстендил", { code: "rp-kyustendil" }]]);
    expect(judicialPlaceFor(raw, "РПКюстендил").placeCode).toBe(
      "rp-kyustendil",
    );
    // …and the fold arm still carries every other spelling, which is the common case.
    expect(judicialPlaceFor(dict, "софийски районен съд").placeCode).toBe(
      "srs",
    );
  });

  it("keeps the declaration's own words when nothing resolves", () => {
    // "Върховна прокуратура" is ambiguous between ВКП and ВАП — not a slip the typo layer
    // can close, and never will be, which is why it is the right example here. (A real
    // misspelling is NOT: the parser now resolves those, so one would only stay unmatched
    // against this two-entry stand-in dictionary and would teach the reader the opposite
    // of what the module does.) We refuse to guess a body, but the source's own text is
    // still the honest thing to show.
    expect(judicialPlaceFor(dict, "Върховна прокуратура")).toEqual({
      placeKind: null,
      placeCode: null,
      placeRaw: "Върховна прокуратура",
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
