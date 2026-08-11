// The per-day group fold, from the outside — through computeSessionMetrics, because that is
// where the contract actually binds: it buckets, it calls majorityFor, and everything it
// returns is keyed by the party string a component then renders.
//
// No day in the corpus spells one group two ways, so these fixtures build the shape the
// corpus does not have. That is the point — without them the page is correct by an
// invariant nothing states, and the failure it protects against is silent: majorityFor's
// only test of membership is a string compare, so one unfolded side means no majority for
// any group, therefore no dissenters anywhere on the page.

import { describe, expect, it } from "vitest";
import { computeSessionMetrics } from "./sessionMetrics";
import { majorityFor } from "./majority";
import { foldedParties, groupLabeller, groupOf } from "./groups";
import type { SessionFile, SessionItem, VoteValue } from "./types";

const item = (no: number, votes: Array<[number, VoteValue]>): SessionItem => {
  const tallies = { yes: 0, no: 0, abstain: 0, absent: 0 };
  for (const [, v] of votes) tallies[v] += 1;
  return {
    item: no,
    tallies,
    votes: votes.map(([mpId, vote]) => ({ mpId, vote })),
  } as SessionItem;
};

/** A day whose ГЕРБ-СДС members are filed under BOTH spellings — 3 and 4 under the variant.
 *  MP 4 breaks the group line, so there is a dissenter to lose. */
const session: SessionFile = {
  ns: "51",
  date: "2024-12-18",
  stenogramId: 1,
  scrapedAt: "2026-01-01T00:00:00.000Z",
  mpParty: {
    "1": "ГЕРБ - СДС",
    "2": "ГЕРБ - СДС",
    "3": "ГЕРБ-СДС",
    "4": "ГЕРБ-СДС",
    "5": "ПП - ДБ",
  },
  sessions: [
    item(1, [
      [1, "yes"],
      [2, "yes"],
      [3, "yes"],
      [4, "no"],
      [5, "no"],
    ]),
  ],
} as SessionFile;

describe("computeSessionMetrics — one group, one row", () => {
  const metrics = computeSessionMetrics(session);
  const first = metrics.perItem[0];

  it("tallies the group once, under the spelling most of it carries", () => {
    expect(first.partyTallies.map((t) => t.party)).toEqual([
      "ГЕРБ - СДС",
      "ПП - ДБ",
    ]);
    const gerb = first.partyTallies.find((t) => t.party === "ГЕРБ - СДС");
    expect({ yes: gerb?.yes, no: gerb?.no }).toEqual({ yes: 3, no: 1 });
  });

  it("keys majorityByParty with the SAME string the tallies carry", () => {
    // The two are read together by SessionItemBreakdown; a key in one form and a lookup in
    // the other is a miss that renders as "no majority" rather than as an error.
    for (const t of first.partyTallies) {
      expect(first.majorityByParty.has(t.party)).toBe(true);
    }
    expect(first.majorityByParty.get("ГЕРБ - СДС")).toBe("yes");
  });

  it("finds the dissenter across the spelling boundary", () => {
    // MP 4 is filed under the variant and votes against the group's 3-1 line. Unfolded, MP 4
    // is a group of two whose own majority is... itself, and the defection disappears.
    expect(first.dissenters).toEqual([
      { mpId: 4, party: "ГЕРБ - СДС", vote: "no", majority: "yes" },
    ]);
    expect(metrics.dissentCount).toBe(1);
  });

  it("counts the group's cohesion over all four members, not two and two", () => {
    // 3 of 4 with the line, plus ПП-ДБ's single member (below the ≥3 floor, excluded).
    expect(first.cohesion).toBeCloseTo(0.75, 5);
  });
});

describe("majorityFor takes the folded map", () => {
  // Four members of one group, two under each spelling, voting 2-2. The group's line is a
  // tie, which this function breaks toward "yes"; the variant half alone voted "no".
  const split = {
    mpParty: {
      "1": "ГЕРБ - СДС",
      "2": "ГЕРБ - СДС",
      "3": "ГЕРБ-СДС",
      "4": "ГЕРБ-СДС",
    },
    sessions: [
      item(1, [
        [1, "yes"],
        [2, "yes"],
        [3, "no"],
        [4, "no"],
      ]),
    ],
  } as unknown as SessionFile;

  it("answers for the whole group", () => {
    const key = groupOf(split.mpParty, 3)!;
    expect(
      majorityFor(split.sessions[0], key, foldedParties(split.mpParty)),
    ).toBe("yes");
  });

  // The trap the contract exists for. Handed a RAW map, the compare matches only the
  // members whose spelling already happens to BE the canonical form — so it does not fail
  // loudly, it answers confidently for half the group, and here that half voted the other
  // way. Which half survives is a property of the spelling, not of the politics.
  it("answers for the wrong half when handed a raw map, which is why callers must not", () => {
    const key = groupOf(split.mpParty, 3)!;
    expect(majorityFor(split.sessions[0], key, split.mpParty!)).toBe("no");
  });

  // And when no member's spelling is already canonical, the group vanishes entirely.
  it("finds nobody at all when no spelling matches the key", () => {
    const key = groupOf(session.mpParty, 5)!;
    expect(key).toBe("ПП-ДБ");
    expect(majorityFor(session.sessions[0], key, session.mpParty!)).toBeNull();
  });
});

describe("groupLabeller", () => {
  it("picks the spelling most members carry, not the first in the map", () => {
    expect(groupLabeller(session.mpParty)("ГЕРБ-СДС")).toBe("ГЕРБ - СДС");
  });

  it("passes an unseen key straight through, so a caller's placeholder survives", () => {
    // sessionMetrics buckets unaffiliated members under „—"; the labeller must not eat it.
    expect(groupLabeller(session.mpParty)("—")).toBe("—");
    expect(groupLabeller(undefined)("ГЕРБ - СДС")).toBe("ГЕРБ - СДС");
  });

  it("does NOT merge two different names", () => {
    const labels = groupLabeller({ "1": "ДПС", "2": "ДПС - НН" });
    expect(labels("ДПС")).toBe("ДПС");
    expect(labels("ДПС-НН")).toBe("ДПС - НН");
  });
});
