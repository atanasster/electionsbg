// `rollcallCoverage` decides whether the site may state, as a fact, that it holds no
// roll-call for an MP's terms. Getting it wrong publishes a false claim about a named
// person, so every uncertain input must collapse to silence.
//
// The first cut of this helper took `nsFolders` alone and was wrong for 70 of the 293 MPs it
// targeted (24%) — `mp_profile` and `mp_seat` are partly disjoint id spaces, so an MP the
// roster files under {42,43} can sit in the corpus at NS 44 under a different seat id. The
// authoritative answer is `hasRollcall` from mp_entry (105); `nsFolders` can only ever
// corroborate the negative.

import { describe, it, expect } from "vitest";
import { rollcallCoverage, ROLLCALL_FIRST_NS } from "./rollcallCoverage";

describe("rollcallCoverage", () => {
  it("is false only when the corpus AND the roster agree the MP is absent", () => {
    // Станишев: 39th + 40th, 2001–2009, and no mp_seat row under any spelling.
    expect(rollcallCoverage(["39", "40"], false)).toBe(false);
    expect(rollcallCoverage(["43"], false)).toBe(false);
  });

  it("NEVER claims absence for an MP the corpus actually holds", () => {
    // The 70-MP defect, pinned. Жельо Иванov Бойчев: profile 2671 says {42,43}, seat 779
    // says NS 44. Arithmetic over nsFolders says "absent"; the corpus says otherwise, and
    // the corpus wins — this is the assertion that stops the site telling 70 people we have
    // no record of votes we are publishing.
    expect(rollcallCoverage(["42", "43"], true)).toBe(true);
    expect(rollcallCoverage(["39", "40"], true)).toBe(true);
    expect(rollcallCoverage([], true)).toBe(true);
  });

  it("is true when the roster alone puts them in the corpus", () => {
    expect(rollcallCoverage(["44"], false)).toBe(true);
    expect(rollcallCoverage(["39", "40", "52"], false)).toBe(true);
  });

  it("says nothing when the route cannot answer", () => {
    // A serving DB whose 105 predates `hasRollcall` sends `undefined`. Treating that as
    // "absent" would revive the whole defect on the first stale deploy, so it is unknown.
    expect(rollcallCoverage(["39", "40"], undefined)).toBeNull();
    expect(rollcallCoverage(["39", "40"], null)).toBeNull();
    // Loading: no entry at all.
    expect(rollcallCoverage(undefined, undefined)).toBeNull();
  });

  it("says nothing when parliament.bg publishes no parliament list", () => {
    // 1,263 of 2,122 MPs on file. An absent list is not evidence of anything.
    expect(rollcallCoverage([], false)).toBeNull();
    expect(rollcallCoverage(undefined, false)).toBeNull();
    expect(rollcallCoverage(null, false)).toBeNull();
  });

  it("ignores unparseable entries rather than counting them as a parliament", () => {
    expect(rollcallCoverage(["", "abc"], false)).toBeNull();
    expect(rollcallCoverage(["abc", "40"], false)).toBe(false);
  });

  it("pins the boundary to the corpus's first covered parliament", () => {
    // A hard-coded 44 in a caller would silently stop matching after a backfill; this is
    // the one place the number lives.
    expect(ROLLCALL_FIRST_NS).toBe(44);
    expect(rollcallCoverage([String(ROLLCALL_FIRST_NS - 1)], false)).toBe(
      false,
    );
    expect(rollcallCoverage([String(ROLLCALL_FIRST_NS)], false)).toBe(true);
  });
});
