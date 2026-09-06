// `leadersByPlace` — the rule that decides which pair colours a place.
//
// ⚠ EVERY CASE HERE PUTS A NAMED PERSON'S COLOUR ON A MAP. A tie broken by anything but the
// ballot number redraws the map between two builds of the same corpus; a place with no votes
// coloured at all attributes a lead to a pair in a place nobody voted in; and a denominator
// that quietly became the VALID votes would print a share this file cannot compute, because
// „не подкрепям никого" is not in the roll-up.

import { describe, expect, it } from "vitest";
import {
  fetchRoundRollup,
  leadersByPlace,
  rollupPath,
  type RoundRollup,
} from "./useRoundRollup";

const rollup = (
  entries: { key: string; votes: [number, number][] }[],
): RoundRollup => ({
  coverage: { basis: "x", sections: 1, excludedSections: 0 },
  entries: entries.map((e) => ({
    key: e.key,
    results: {
      votes: e.votes.map(([partyNum, totalVotes]) => ({
        partyNum,
        totalVotes,
      })),
    },
  })),
});

describe("leadersByPlace", () => {
  it("picks the largest ticket and reports its share of the TICKET votes", () => {
    const m = leadersByPlace(
      rollup([
        {
          key: "BLG",
          votes: [
            [1, 30],
            [2, 70],
          ],
        },
      ]),
    );
    expect(m.get("BLG")).toEqual({
      number: 2,
      votes: 70,
      shareOfTicketVotes: 0.7,
    });
  });

  it("breaks a tie on the ballot number, so a rebuild colours the same way", () => {
    const m = leadersByPlace(
      rollup([
        {
          key: "BLG",
          votes: [
            [9, 50],
            [3, 50],
          ],
        },
      ]),
    );
    expect(m.get("BLG")?.number).toBe(3);
  });

  it("gives a place that cast nothing NO leader — not ticket 1 with zero votes", () => {
    // ⚠ Colouring it would put a named pair's colour on a place nobody voted in, which the map
    // then labels „X води с 0.0%".
    const m = leadersByPlace(
      rollup([
        {
          key: "EMPTY",
          votes: [
            [1, 0],
            [2, 0],
          ],
        },
        { key: "NONE", votes: [] },
        { key: "REAL", votes: [[1, 5]] },
      ]),
    );
    expect(m.has("EMPTY")).toBe(false);
    expect(m.has("NONE")).toBe(false);
    // The control: the same call DOES produce a leader where there are votes, so the two
    // absences above are the rule firing rather than the function returning nothing.
    expect(m.get("REAL")?.number).toBe(1);
  });

  it("returns an empty map for a rollup that never arrived", () => {
    expect(leadersByPlace(null).size).toBe(0);
  });
});

describe("fetchRoundRollup", () => {
  const respond = (body: unknown, status = 200) => {
    globalThis.fetch = (async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
      })) as typeof fetch;
  };

  it("returns the roll-up from a good body", async () => {
    respond(rollup([{ key: "BLG", votes: [[1, 5]] }]));
    expect((await fetchRoundRollup("p"))?.entries[0].key).toBe("BLG");
  });

  it("refuses a body whose leaves `leadersByPlace` dereferences are missing", async () => {
    // ⚠ THE LEAVES, NOT THE CONTAINER. `leadersByPlace` reads `e.results.votes` and each row's
    // `totalVotes` unconditionally; a guard stopping at „entries is an array" lets a truncated
    // file through and the read throws inside a `useMemo`, which unmounts the React root.
    for (const bad of [
      "<!doctype html>",
      {},
      { entries: {} },
      { entries: [{}] },
      { entries: [{ key: "A" }] },
      { entries: [{ key: "A", results: {} }] },
      { entries: [{ key: "A", results: { votes: [{ partyNum: 1 }] } }] },
      { entries: [{ key: 7, results: { votes: [] } }] },
    ]) {
      respond(bad);
      expect(await fetchRoundRollup("p"), JSON.stringify(bad)).toBeNull();
    }
  });

  it("returns null for a 404 and for a rejected fetch, not a throw", async () => {
    respond({}, 404);
    expect(await fetchRoundRollup("p")).toBeNull();
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    expect(await fetchRoundRollup("p")).toBeNull();
  });
});

describe("rollupPath", () => {
  it("names the round's own file", () => {
    expect(rollupPath("2021_11_14_pvr", 2, "region")).toBe(
      "2021_11_14_pvr/tur2/region_votes.json",
    );
    expect(rollupPath("2021_11_14_pvr", 1, "abroad")).toBe(
      "2021_11_14_pvr/tur1/abroad.json",
    );
  });
});
