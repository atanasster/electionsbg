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
  localSeatKey,
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

describe("localSeatKey — the cross-cycle identity of a seat", () => {
  it("reads a mayor's seat off the ref, район shards included", () => {
    expect(
      localSeatKey("mayor", "2023_10_29_mi:BGS01:mayor", "obshtina", "BGS01"),
    ).toBe("mayor\tBGS01:mayor");
    // Sofia's районни кметове arrive as role 'mayor' on their own S2*** shard, so each
    // район is its own seat rather than 24 seats sharing the city's key.
    expect(
      localSeatKey("mayor", "2019_10_27_mi:S2301:mayor", "obshtina", "S2301"),
    ).toBe("mayor\tS2301:mayor");
    expect(localSeatKey("mayor", "2023_10_29_mi:BGS01:mayor", null, null)).toBe(
      "mayor\tBGS01:mayor",
    );
  });

  it("keys a councillor on the COUNCIL, never the ballot position", () => {
    // A re-elected councillor is usually at another list position and often on another
    // list, so partyNum:listPos must not reach the key.
    expect(
      localSeatKey(
        "councillor",
        "2023_10_29_mi:VID09:12:4",
        "obshtina",
        "VID09",
      ),
    ).toBe("councillor\tVID09");
    expect(
      localSeatKey(
        "councillor",
        "2019_10_27_mi:VID09:3:11",
        "obshtina",
        "VID09",
      ),
    ).toBe("councillor\tVID09");
  });

  it("keys a village mayor on the §T2 settlement — and refuses the ref's index", () => {
    // The whole reason the ref is not consulted here: `ekatte` is empty in every bundle
    // today, so the ref falls back to a per-cycle ARRAY INDEX. Both refs below are index 4
    // of their cycle and are different villages; both must key off the resolved EKATTE.
    expect(
      localSeatKey(
        "village_mayor",
        "2023_10_29_mi:JAM04:kmetstvo:4",
        "settlement",
        "87374",
      ),
    ).toBe("village_mayor\tsettlement:87374");
    expect(
      localSeatKey(
        "village_mayor",
        "2019_10_27_mi:JAM04:kmetstvo:4",
        "settlement",
        "87374",
      ),
    ).toBe("village_mayor\tsettlement:87374");
    // Degraded to the ОБЩИНА (§T2 could not resolve the name) — one община holds many
    // кметства, so there is no seat to name and the rule must not fire at all.
    expect(
      localSeatKey(
        "village_mayor",
        "2023_10_29_mi:JAM04:kmetstvo:4",
        "obshtina",
        "JAM04",
      ),
    ).toBeNull();
    expect(
      localSeatKey(
        "village_mayor",
        "2023_10_29_mi:JAM04:kmetstvo:4",
        "settlement",
        null,
      ),
    ).toBeNull();
  });

  it("gives a район mayor no seat — neither half of the row is stable", () => {
    // Plovdiv/Varna районни (46 roles): an index-based ref, and a typed place that is the
    // PARENT община, so 5-6 simultaneous holders would otherwise share one key.
    expect(
      localSeatKey(
        "rayon_mayor",
        "2023_10_29_mi:PDV22:district:2",
        "obshtina",
        "PDV22",
      ),
    ).toBeNull();
  });

  it("returns null for a malformed ref rather than a truncated key", () => {
    expect(
      localSeatKey("mayor", "2023_10_29_mi", "obshtina", "BGS01"),
    ).toBeNull();
    expect(
      localSeatKey("mayor", "2023_10_29_mi::mayor", "obshtina", "BGS01"),
    ).toBeNull();
  });
});
