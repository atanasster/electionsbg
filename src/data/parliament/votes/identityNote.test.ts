// The on-page identity caveat („Групите се броят по име: …") is prose, in two languages,
// describing constants that live in partyPairs.ts. Nothing structural stops the two from
// drifting: add a fourth continuation, retire one, or move a floor, and the page's own
// caveat becomes false in both languages, at a 200, with every other test still green.
//
// This is the same shape as gen_sql/shlyo_query_fold.test.ts and bill_and_topics.data.test.ts
// — a rule that necessarily exists twice, with a test asserting the two sides agree.

import { describe, expect, it } from "vitest";
import bg from "@/locales/bg/translation.json";
import en from "@/locales/en/translation.json";
import {
  COALITION_COMPONENTS,
  GROUP_CONTINUATIONS,
  MIN_ITEMS,
  MIN_SHARE_OF_BUSIEST,
} from "./partyPairs";

const NOTE_KEY = "corr_history_identity_note";
const dicts: [string, Record<string, string>][] = [
  ["bg", bg as Record<string, string>],
  ["en", en as Record<string, string>],
];

// The page spells a group „ПП - ДБ" and the map keys it "ПП-ДБ"; rule 1's fold is exactly
// that difference, so the comparison applies it rather than demanding one spelling.
const fold = (s: string) => s.replace(/\s*[-–—]\s*/g, "-").toUpperCase();

describe("the on-page identity note agrees with the rules it describes", () => {
  it.each(dicts)("%s names every curated continuation", (_lang, dict) => {
    const note = fold(dict[NOTE_KEY]);
    for (const from of Object.keys(GROUP_CONTINUATIONS)) {
      expect(
        note,
        `${NOTE_KEY} does not mention the continuation "${from}"`,
      ).toContain(fold(from));
    }
  });

  it.each(dicts)("%s names every curated coalition", (_lang, dict) => {
    const note = fold(dict[NOTE_KEY]);
    for (const coalition of Object.keys(COALITION_COMPONENTS)) {
      expect(
        note,
        `${NOTE_KEY} does not mention the coalition "${coalition}"`,
      ).toContain(fold(coalition));
    }
  });

  // The floors are INTERPOLATED, not typed out. Asserting the placeholders — and the
  // absence of a hard-coded number beside them — is what keeps a future edit from quietly
  // going back to prose that a constant change cannot reach.
  it.each(dicts)(
    "%s interpolates both floors instead of restating them",
    (_lang, dict) => {
      const note = dict[NOTE_KEY];
      expect(note).toContain("{{minItems}}");
      expect(note).toContain("{{minSharePct}}");
      expect(note).not.toMatch(new RegExp(`\\b${MIN_ITEMS}\\b`));
      expect(note).not.toMatch(
        new RegExp(`\\b${MIN_SHARE_OF_BUSIEST * 100}\\s*%`),
      );
    },
  );

  // The other half of the claim: the note says the split is SHOWN. If either of the two
  // rival successors were ever added to GROUP_CONTINUATIONS, the page would be asserting
  // the opposite of what the module does.
  it("keeps the split's other successors out of the continuation map", () => {
    const keys = Object.keys(GROUP_CONTINUATIONS).map(fold);
    expect(keys).not.toContain(fold("ДПС - ДПС"));
    expect(keys).not.toContain(fold("АПС"));
    for (const [, dict] of dicts) {
      expect(fold(dict[NOTE_KEY])).toContain(fold("ДПС - ДПС"));
      expect(fold(dict[NOTE_KEY])).toContain("АПС");
    }
  });
});
