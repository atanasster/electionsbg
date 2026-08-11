// The two things the group fold buys this metric. Neither is visible in today's artifact —
// no day in the corpus spells one group two ways, and every NS's last sitting happens to
// use the dominant spelling — so both fixtures deliberately build the shape the corpus does
// not currently have. That is the point: without them the metric is correct by luck.

import { describe, expect, it } from "vitest";
import { computeSimilarityHeadline } from "./similarity_headline";
import type { SimilarityOutput } from "./similarity";
import type { SessionFile } from "./types";

/** A day with no items — this metric reads only `mpParty` and the similarity aggregate,
 *  and `sessions.length` is what weights the label vote, so items are given where they
 *  matter to that. */
const day = (
  date: string,
  mpParty: Record<string, string>,
  items = 1,
): SessionFile =>
  ({
    ns: "51",
    date,
    stenogramId: 1,
    scrapedAt: "2026-01-01T00:00:00.000Z",
    mpParty,
    sessions: Array.from({ length: items }, (_, k) => ({
      item: k + 1,
      tallies: { yes: 0, no: 0, abstain: 0, absent: 0 },
      votes: [],
    })),
  }) as SessionFile;

const similarity = (entries: Array<[number, number[]]>): SimilarityOutput =>
  ({
    entries: entries.map(([mpId, peers]) => ({
      mpId,
      topK: peers.map((mpId, i) => ({ mpId, score: 0.9 - i * 0.01 })),
    })),
  }) as unknown as SimilarityOutput;

describe("computeSimilarityHeadline", () => {
  it("does not count a colleague as cross-party because the day spelled the group twice", () => {
    // MPs 1 and 2 are both ГЕРБ-СДС, filed under the two spellings; 3 is a real stranger.
    // Unfolded, the seed's topK reads as TWO cross-party twins where one is the truth —
    // and that count is the tile's entire claim, so it overstates rather than mislabels.
    const out = computeSimilarityHeadline(similarity([[1, [2, 3]]]), [
      day("2024-12-18", {
        "1": "ГЕРБ - СДС",
        "2": "ГЕРБ-СДС",
        "3": "ПП - ДБ",
      }),
    ]);
    expect(out?.crossPartyCount).toBe(1);
    expect(out?.twins.map((t) => t.mpId)).toEqual([3]);
  });

  it("publishes the corpus-wide spelling even when the LAST sitting used the variant", () => {
    // The 51st's variant days run to 2024-12-20. A parliament dissolving there would have
    // published „ГЕРБ-СДС" — a label no other artifact and no party-colour row carries.
    const out = computeSimilarityHeadline(similarity([[1, [2]]]), [
      day("2024-11-11", { "1": "ГЕРБ - СДС", "2": "ПП - ДБ" }, 50),
      day("2024-12-20", { "1": "ГЕРБ-СДС", "2": "ПП-ДБ" }, 5),
    ]);
    expect(out?.seedPartyShort).toBe("ГЕРБ - СДС");
    expect(out?.twins.map((t) => t.partyShort)).toEqual(["ПП - ДБ"]);
  });

  it("still reads the affiliation from the LAST sitting, not the busiest one", () => {
    // Folding the spelling must not fold the timeline: a member who changed groups is
    // published under the group they sit in now.
    const out = computeSimilarityHeadline(similarity([[1, [2]]]), [
      day("2024-11-11", { "1": "ИТН", "2": "ПП - ДБ" }, 50),
      day("2025-03-26", { "1": "НЕЗ", "2": "ПП - ДБ" }, 5),
    ]);
    expect(out?.seedPartyShort).toBe("НЕЗ");
  });

  it("returns null for an NS with no sessions rather than throwing", () => {
    expect(computeSimilarityHeadline(similarity([[1, [2]]]), [])).toBeNull();
  });
});
