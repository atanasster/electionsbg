// The overlap gate on MP-to-MP vote similarity. Two bugs it guards against,
// both reported from the live "Гласово сходство" section on a person page:
//   1. the "most similar" list showed peers with FEWER shared votes than the
//      "most different" list, because topK had no minimum-overlap floor while
//      bottomK required 5 — the two sides ranked on different sample sizes.
//   2. a peer sharing a handful of votes that happen to agree posted a high
//      cosine off that tiny sample and out-ranked peers with a fuller record.
//
// The gate is adaptive: a flat 25 shared votes once a chamber has votes to
// spare, relaxing to "shared ≥70% of the seed's own votes" (never below 5) in a
// freshly-elected parliament where nobody has cast 25 yet.
//
// Pure function — `node` Vitest project, no network, no filesystem.

import { describe, expect, it } from "vitest";
import { computeSimilarity } from "./similarity";
import type { SessionFile, SessionVote } from "./types";

// Build one session file whose items are described column-per-MP: each entry in
// `records` is [mpId, votesString] where votesString has one char per item
// ('y' yes, 'n' no, 'a' abstain, '.' absent). All records must be equal length.
const session = (ns: string, records: Array<[number, string]>): SessionFile => {
  const width = records[0][1].length;
  const toVote = (c: string): SessionVote["vote"] =>
    c === "y" ? "yes" : c === "n" ? "no" : c === "a" ? "abstain" : "absent";
  return {
    ns,
    date: "2026-05-01",
    stenogramId: 1,
    scrapedAt: "2026-05-01T00:00:00.000Z",
    sessions: Array.from({ length: width }, (_, i) => ({
      item: i + 1,
      tallies: { yes: 0, no: 0, abstain: 0, absent: 0 },
      votes: records.map(([mpId, s]) => ({ mpId, vote: toVote(s[i]) })),
    })),
  };
};

const peer = (entry: { topK: { mpId: number }[] }, mpId: number) =>
  entry.topK.find((p) => p.mpId === mpId);

describe("computeSimilarity overlap gate", () => {
  it("keeps top and bottom lists on the same reliable pool (no side out-samples the other)", () => {
    // Seed (1) casts 40 votes — past the ~36 threshold, so the flat 25-vote
    // floor applies. Peer 2 shares all 40 and agrees; peer 3 shares only 10 (30
    // absents) — below 25, so it must appear in NEITHER list.
    const seed = "y".repeat(40);
    const full = "n".repeat(40); // shares 40, always disagrees
    const sparse = "y".repeat(10) + ".".repeat(30); // shares only 10
    const out = computeSimilarity([
      session("52", [
        [1, seed],
        [2, full],
        [3, sparse],
      ]),
    ]);
    const e = out.entries.find((x) => x.mpId === 1)!;
    const allShown = [...e.topK, ...e.bottomK].map((p) => p.mpId);
    expect(allShown).toContain(2);
    expect(allShown).not.toContain(3); // gated out: 10 < 25
    // Every shown peer clears the same floor — the two sides never differ in
    // minimum overlap.
    for (const p of [...e.topK, ...e.bottomK])
      expect(p.overlap).toBeGreaterThanOrEqual(25);
  });

  it("drops a small-sample high-agreement peer that would otherwise top the similar list", () => {
    // Young parliament: 8 items total. Seed (1) votes all 8. Peer 2 (same-ish)
    // shares all 8. Peer 3 shares only 5 and agrees on all of them — the exact
    // shape reported live (5 shared, high cosine). Gate = ceil(0.7*8)=6, so peer
    // 3 (overlap 5) is dropped while peer 2 (overlap 8) stays.
    const seed = "yynyynyy";
    const twin = "yynyynyn"; // shares 8, agrees on 7
    const small = "yynyy..."; // shares 5, agrees on all 5
    const out = computeSimilarity([
      session("53", [
        [1, seed],
        [2, twin],
        [3, small],
      ]),
    ]);
    const e = out.entries.find((x) => x.mpId === 1)!;
    expect(peer(e, 2)).toBeTruthy();
    expect(peer(e, 3)).toBeFalsy(); // overlap 5 < ceil(0.7*8)=6
  });

  it("never trusts fewer than the hard minimum of shared votes", () => {
    // 4 items total. Gate = max(5, min(25, ceil(0.7*4)=3)) = 5, but nobody can
    // share 5 of 4, so every list is empty — the honest 'not enough overlap'
    // state rather than a cosine off 3-4 votes.
    const out = computeSimilarity([
      session("53", [
        [1, "yyny"],
        [2, "yynn"],
        [3, "nnyy"],
      ]),
    ]);
    const e = out.entries.find((x) => x.mpId === 1)!;
    expect(e.topK).toHaveLength(0);
    expect(e.bottomK).toHaveLength(0);
  });
});
