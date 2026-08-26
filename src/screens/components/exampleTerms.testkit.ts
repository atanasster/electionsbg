// The `EXAMPLE_TERMS` rules that hold for ANY registry chip set.
//
// ⚠️ DELIBERATELY PARTIAL. A page's own corpus hazards — the em dash on /persons, the `&quot;`
// entities and the absent `searchFoldTokens` on /companies — stay in that page's own test file,
// because those assertions ARE the documentation of the hazard and folding them together would
// leave each corpus's trap explained nowhere. Only the rules that are properties of a chip SET
// rather than of a corpus live here.
//
// The Cyrillic rule is likewise per-file: /companies legitimately exempts its EIK chip and
// /persons does not.

import { expect } from "vitest";
import { SEARCH_MIN_CHARS, termLength } from "@/ux/data_table/searchTerm";

/** Assert the corpus-independent chip rules. Call from each page's own example suite. */
export const assertRegistryExamples = (terms: readonly string[]): void => {
  // A chip below the floor renders the „въведете поне 3 знака" hint on click — the one state a
  // worked example must never demonstrate.
  for (const term of terms)
    expect(
      termLength(term.trim()),
      `"${term}" is below the engine's floor`,
    ).toBeGreaterThanOrEqual(SEARCH_MIN_CHARS);

  // They render as chips under the field on the landing; a dozen is a toolbar, not a hint.
  expect(
    terms.length,
    "a single chip teaches nothing about the set",
  ).toBeGreaterThan(1);
  expect(terms.length, "too many chips to read as a hint").toBeLessThanOrEqual(
    4,
  );
};
