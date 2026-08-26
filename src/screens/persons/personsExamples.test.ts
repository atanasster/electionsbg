// `EXAMPLE_TERMS` — the chips on the empty search box — as a claim about the corpus.
//
// WHY A TEST FOR THREE STRINGS. They are the first thing a new reader clicks, and the constant's
// own contract is that each returns rows: „a chip that returned nothing would be a worse
// introduction than no chip". One of them did. The corpus writes court names with an EM DASH
// (U+2014) — „Окръжен съд — Варна" — and the hyphen-minus a keyboard produces matched **0 rows**
// against 47 for the real spelling (measured 2026-08-26 on `person_browse_table`). The search
// folds case and transliteration; it does not fold punctuation.
//
// This runs WITHOUT Postgres, so it cannot check row counts. What it can check is the class of
// mistake that produced the defect — a value typed from memory rather than copied from the data
// — plus the rules that make a chip meaningful at all on this resource.

import { describe, it, expect } from "vitest";
import { EXAMPLE_TERMS } from "./personsBrowseConstants";
import { SEARCH_MIN_CHARS, termLength } from "@/ux/data_table/searchTerm";

describe("EXAMPLE_TERMS", () => {
  it("every chip is a term the engine would accept", () => {
    // A chip below the floor renders the „enter at least 3 characters" hint on click — the one
    // state a worked example must never demonstrate.
    for (const term of EXAMPLE_TERMS)
      expect(
        termLength(term.trim()),
        `"${term}" is below the engine's floor`,
      ).toBeGreaterThanOrEqual(SEARCH_MIN_CHARS);
  });

  it("no chip carries a hyphen-minus between words", () => {
    // THE DEFECT, generalised. `person_browse_table` writes institution names with an em dash;
    // a hyphen-minus in that position is a value the corpus does not contain, and the failure is
    // silent — a chip that returns „няма резултати" reads as an empty corpus, not as a typo.
    for (const term of EXAMPLE_TERMS)
      expect(
        term,
        `"${term}" uses a hyphen where the corpus uses an em dash`,
      ).not.toMatch(/\S\s-\s\S/);
  });

  it("is Cyrillic — these are values in a Bulgarian corpus", () => {
    // Deliberately untranslated: an English chip returns nothing. Asserted so the choice is a
    // decision rather than an oversight the next reader has to guess at.
    for (const term of EXAMPLE_TERMS)
      expect(term, `"${term}" is not Cyrillic`).toMatch(/\p{Script=Cyrillic}/u);
  });

  it("offers more than one KIND of example", () => {
    // The point of the set is to teach what the box accepts. Three names would teach one third
    // of it — this resource searches `name` AND `institution`, and a reader who has only seen a
    // personal name will not try „Окръжен съд".
    const multiWord = EXAMPLE_TERMS.filter((t) => t.trim().includes(" "));
    expect(multiWord.length).toBeGreaterThan(0);
    expect(multiWord.length).toBeLessThan(EXAMPLE_TERMS.length);
  });

  it("stays a short set", () => {
    // They render as chips under the field on the landing; a dozen is a toolbar, not a hint.
    expect(EXAMPLE_TERMS.length).toBeGreaterThan(1);
    expect(EXAMPLE_TERMS.length).toBeLessThanOrEqual(4);
  });
});
