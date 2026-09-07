// `sectionLeaders` — which pair a polling station's marker is coloured for.
//
// ⚠ EVERY CASE HERE PRODUCES A PLAUSIBLE MAP. A station coloured for ticket 1 because nobody
// voted, a station from a NEIGHBOURING settlement plotted on this one's map, or a tie broken
// differently on two loads — none of them errors, and all three look like a working map of a
// place a reader has never seen before.

import { describe, expect, it } from "vitest";
import {
  sectionLeaders,
  type PresidentialSectionRow,
} from "./useSectionRollup";

const row = (
  code: string,
  ekatte: string,
  votes: [number, number][],
): PresidentialSectionRow => ({
  code,
  ekatte,
  votes: votes.map(([partyNum, totalVotes]) => ({ partyNum, totalVotes })),
});

describe("the leading ticket per section", () => {
  it("keeps only the settlement asked for", () => {
    // The shard is per OBLAST — hundreds of stations across dozens of settlements — so the
    // filter is what stops a settlement's map plotting its neighbours' polling stations.
    const leaders = sectionLeaders(
      [row("A", "87391", [[6, 10]]), row("B", "99999", [[6, 10]])],
      "87391",
    );
    expect([...leaders.keys()]).toEqual(["A"]);
  });

  it("gives a station where nobody voted NO leader, not ticket 1 with zero", () => {
    // ⚠ A ZERO-VOTE STATION IS REAL — a mobile section nobody used, a ship section. Colouring
    // it would put a named pair's colour on a station nobody voted at, and the marker would sit
    // on the map indistinguishable from a real result.
    const leaders = sectionLeaders(
      [
        row("A", "87391", [
          [6, 0],
          [15, 0],
        ]),
        row("B", "87391", []),
      ],
      "87391",
    );
    expect(leaders.size).toBe(0);
  });

  it("breaks a tie on the ballot number, so one corpus always colours the same way", () => {
    // Without a deterministic tie-break the same data colours differently between loads —
    // a map that changes its answer with no data change.
    const first = sectionLeaders(
      [
        row("A", "87391", [
          [15, 7],
          [6, 7],
        ]),
      ],
      "87391",
    );
    const second = sectionLeaders(
      [
        row("A", "87391", [
          [6, 7],
          [15, 7],
        ]),
      ],
      "87391",
    );
    expect(first.get("A")?.number).toBe(6);
    expect(second.get("A")?.number).toBe(6);
  });

  it("reports the leader's share of THAT station's own votes", () => {
    // The marker's tooltip prints this beside the pair's name; taken over the wrong denominator
    // it reads as a national share on a station of ninety people.
    const leaders = sectionLeaders(
      [
        row("A", "87391", [
          [6, 54],
          [15, 36],
        ]),
      ],
      "87391",
    );
    expect(leaders.get("A")).toEqual({ number: 6, votes: 54, share: 0.6 });
  });

  it("skips a row with no ЕКАТТЕ rather than attributing it", () => {
    // Mobile, ship and abroad sections carry no settlement the catalogue can name. They cannot
    // be placed, and guessing one would put a station in a village it was never in.
    const leaders = sectionLeaders(
      [{ code: "A", votes: [{ partyNum: 6, totalVotes: 10 }] }],
      "87391",
    );
    expect(leaders.size).toBe(0);
  });
});
