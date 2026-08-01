// Unit test for the shared winner-resolution + ref-key module that keeps resolve_persons and the
// personSlug bake (decorate_local_person_links) addressing the same rows. No DB, no fs.

import { describe, it, expect } from "vitest";
import {
  pickLocalWinner,
  mayorRef,
  councillorRef,
  kmetstvoRef,
  districtRef,
  districtsAreShardedElsewhere,
} from "./localPersonRefs";

describe("pickLocalWinner", () => {
  it("returns the single elected candidate", () => {
    expect(
      pickLocalWinner([
        { candidateName: "A", isElected: false, votes: 40 },
        { candidateName: "B", isElected: true, votes: 60 },
      ])?.candidateName,
    ).toBe("B");
  });

  it("picks the higher-vote finalist when CIK marks BOTH runoff finalists elected", () => {
    // The exact trap: a naive find(isElected) returns "A" (the loser); the winner has more votes.
    expect(
      pickLocalWinner([
        { candidateName: "A", isElected: true, votes: 45 },
        { candidateName: "B", isElected: true, votes: 55 },
      ])?.candidateName,
    ).toBe("B");
  });

  it("prefers the round-2 table over round 1", () => {
    expect(
      pickLocalWinner(
        [
          { candidateName: "A", isElected: true, votes: 90 },
          { candidateName: "B", isElected: true, votes: 10 },
        ],
        [
          { candidateName: "A", isElected: true, votes: 40 },
          { candidateName: "B", isElected: true, votes: 60 },
        ],
      )?.candidateName,
    ).toBe("B");
  });

  it("falls back to the highest-vote named candidate when none is marked elected", () => {
    expect(
      pickLocalWinner([
        { candidateName: "A", votes: 30 },
        { candidateName: "B", votes: 70 },
      ])?.candidateName,
    ).toBe("B");
  });

  it("returns undefined for an empty / nameless pool", () => {
    expect(pickLocalWinner([])).toBeUndefined();
    expect(pickLocalWinner(undefined, undefined)).toBeUndefined();
    expect(pickLocalWinner([{ isElected: true, votes: 10 }])).toBeUndefined();
  });
});

describe("ref keys", () => {
  it("mayor + councillor refs are the unprefixed person_role.ref form", () => {
    expect(mayorRef("2023_10_29_mi", "BGS01")).toBe(
      "2023_10_29_mi:BGS01:mayor",
    );
    expect(councillorRef("2023_10_29_mi", "BGS01", 5, 3)).toBe(
      "2023_10_29_mi:BGS01:5:3",
    );
  });

  it("kmetstvo/район refs use ekatte/districtCode when present, else the array index", () => {
    expect(kmetstvoRef("2023_10_29_mi", "BGS01", "07079", 4)).toBe(
      "2023_10_29_mi:BGS01:kmetstvo:07079",
    );
    expect(kmetstvoRef("2023_10_29_mi", "BGS01", "", 4)).toBe(
      "2023_10_29_mi:BGS01:kmetstvo:4",
    );
    expect(kmetstvoRef("2023_10_29_mi", "BGS01", undefined, 0)).toBe(
      "2023_10_29_mi:BGS01:kmetstvo:0",
    );
    expect(districtRef("2023_10_29_mi", "PDV22", "PDV22-01", 2)).toBe(
      "2023_10_29_mi:PDV22:district:PDV22-01",
    );
    expect(districtRef("2023_10_29_mi", "PDV22", "", 2)).toBe(
      "2023_10_29_mi:PDV22:district:2",
    );
  });

  it("only the Sofia parent bundle has its районни sharded elsewhere", () => {
    expect(districtsAreShardedElsewhere("SOF")).toBe(true);
    expect(districtsAreShardedElsewhere("PDV22")).toBe(false);
    expect(districtsAreShardedElsewhere("VAR06")).toBe(false);
  });
});
