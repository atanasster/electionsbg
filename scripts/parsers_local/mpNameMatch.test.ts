// Unit test for the MP name-match rule (docs/plans/local-mp-photo-links-v1.md):
// exact normalised full name, unique in the index, at least two tokens. No fs.

import { describe, it, expect } from "vitest";
import {
  buildMpNameIndex,
  isAmbiguousMpName,
  matchMp,
  type MpIndexEntry,
  type MpNameIndex,
} from "./mpNameMatch";

const MPS: MpIndexEntry[] = [
  { id: 1, normalizedName: "ВАЛЕРИ СТЕФАНОВ ВЪЛКОВ", photoUrl: "/p/1.webp" },
  { id: 2, normalizedName: "МАРИЯ ИВАНОВА МИЛЕВА-ГЕОРГИЕВА" },
  { id: 3, normalizedName: "ГЕОРГИ ИВАНОВ ГЕОРГИЕВ", photoUrl: "/p/3.webp" },
  { id: 4, normalizedName: "ГЕОРГИ ИВАНОВ ГЕОРГИЕВ" },
];

describe("matchMp", () => {
  const idx = buildMpNameIndex(MPS);

  it("matches an exact full name, ignoring case and spacing", () => {
    expect(matchMp("Валери  Стефанов вълков", idx)?.id).toBe(1);
  });

  it("refuses a different middle name — a different father", () => {
    expect(matchMp("Валери Димов Вълков", idx)).toBeUndefined();
  });

  it("matches a hyphenated four-part name either way it is spelled", () => {
    expect(matchMp("Мария Иванова Милева-Георгиева", idx)?.id).toBe(2);
    expect(matchMp("Мария Иванова Милева - Георгиева", idx)?.id).toBe(2);
  });

  it("refuses a two-part name against a three-part MP", () => {
    expect(matchMp("Валери Вълков", idx)).toBeUndefined();
  });

  it("refuses a one-token or empty name", () => {
    const one = buildMpNameIndex([{ id: 9, normalizedName: "МАДОНА" }]);
    expect(matchMp("Мадона", one)).toBeUndefined();
    expect(matchMp("", idx)).toBeUndefined();
    expect(matchMp(undefined, idx)).toBeUndefined();
  });

  it("refuses a name held by two MPs instead of letting the photo pick", () => {
    expect(matchMp("Георги Иванов Георгиев", idx)).toBeUndefined();
    expect(isAmbiguousMpName("Георги Иванов Георгиев", idx)).toBe(true);
    expect(isAmbiguousMpName("Валери Стефанов Вълков", idx)).toBe(false);
  });

  it("mutation check: without the ambiguity guard the same input would match", () => {
    // Rebuild the index with the collision bookkeeping stripped out (last entry wins).
    // If this stops matching, the refusal above is vacuous rather than enforced.
    const unguarded: MpNameIndex = { byFull: new Map(), ambiguous: new Set() };
    for (const m of MPS) {
      const single = buildMpNameIndex([m]);
      for (const [k, v] of single.byFull) unguarded.byFull.set(k, v);
    }
    expect(matchMp("Георги Иванов Георгиев", unguarded)?.id).toBe(4);
  });

  it("does not treat the same MP listed twice as a collision", () => {
    const dup = buildMpNameIndex([MPS[0], MPS[0]]);
    expect(matchMp("Валери Стефанов Вълков", dup)?.id).toBe(1);
    expect(dup.ambiguous.size).toBe(0);
  });
});
