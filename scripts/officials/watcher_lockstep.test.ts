// The executive ingest and its watcher must own the SAME slice of the register.
//
// `scripts/watch/sources/cacbg_officials.ts` fingerprints the set of
// declarations the ingest would process, so that a new filing flips the
// watcher and triggers a re-ingest. If the two category filters drift, the
// watcher silently stops tracking part of the corpus — which is exactly how
// `cacbg_officials` once tracked 489 of 548 declarations with two of the three
// ingest buckets never watched at all.
//
// Both sides state the lockstep in a comment. This asserts it. Pure — `node`
// Vitest project, no network.

import { describe, expect, it } from "vitest";
import { CATEGORY_MAP, categoriseRaw } from "./categorise";
import { CATEGORY_SUBSTRINGS } from "../watch/sources/cacbg_officials";

describe("ingest ↔ watcher category lockstep", () => {
  it("watches exactly the substrings the ingest buckets on", () => {
    const ingestSubstrings = CATEGORY_MAP.flatMap((b) => b.substrings).sort();
    expect([...CATEGORY_SUBSTRINGS].sort()).toEqual(ingestSubstrings);
  });

  // Stronger than string equality: the two must agree on real category names,
  // which is what actually matters if either side ever gains a different
  // matching rule.
  it("agrees with the watcher on every real register category name", () => {
    const REAL_CATEGORIES = [
      // Owned by the executive ingest.
      "Министър-председател, заместник министър-председатели, министри и заместник-министри",
      "Областни управители и заместник-областни управители",
      "Председатели и зам. председатели на държавни агенции, председателите и членовете на държавни комисии, изпълнителните директори на изпълнителните агенции, ръковод. на държавни институции създадени със закон или постановление на МС, и техните заместници",
      // Not owned — other ingests or out of scope.
      "Народни представители",
      "Кметове, и зам.-кметове на общини, кметовете и зам.-кметовете на райони, председателите на общинските съвети, общинските съветници и гл. архитекти на общините и районите",
      "Председатели на ВКС и на ВАС, главен прокурор, техните заместници",
      "Ръководители на задгранични представителства на Република България",
      "Президент и вицепрезидент",
    ];
    const watcherMatches = (name: string) =>
      CATEGORY_SUBSTRINGS.some((sub) => name.includes(sub));
    for (const name of REAL_CATEGORIES) {
      expect(
        { name, watched: watcherMatches(name) },
        `watcher and ingest disagree on: ${name}`,
      ).toEqual({ name, watched: categoriseRaw(name) !== null });
    }
  });
});
