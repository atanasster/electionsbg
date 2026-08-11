// The shared group identity, and the gate that keeps the six metrics reading it the same
// way. Fixtures mirror the real defect: the 51st NS files sixteen days as „ГЕРБ-СДС"/„ПП-ДБ"
// and the rest as „ГЕРБ - СДС"/„ПП - ДБ", one group each.

import { describe, expect, it } from "vitest";
import { foldedParties, groupLabels, groupOf } from "./groups";
import { computeAttendance } from "./attendance";
import { computeCohesion } from "./cohesion";
import { computeDissents } from "./dissents";
import { computeLoyalty } from "./loyalty";
import { computePartyCorrelation } from "./party_correlation";
import { computePartyPairBreaks } from "./party_pair_breaks";
import type { SessionFile } from "./types";

const VOTE = {
  y: "yes",
  n: "no",
  a: "abstain",
  "-": "absent",
} as const;

/** One plenary day: `spellings` maps a group's label ON THAT DAY to how its (single) member
 *  voted on each item — one character per item, "y"/"n"/"a"/"-". */
const day = (date: string, spellings: Record<string, string>): SessionFile => {
  const labels = Object.keys(spellings);
  const items = spellings[labels[0]].length;
  const mpParty: Record<string, string> = {};
  labels.forEach((label, i) => (mpParty[String(i + 1)] = label));
  return {
    ns: "51",
    date,
    stenogramId: 1,
    scrapedAt: "2026-01-01T00:00:00.000Z",
    mpParty,
    sessions: Array.from({ length: items }, (_, k) => {
      const votes = labels.map((label, i) => ({
        mpId: i + 1,
        vote: VOTE[spellings[label][k] as keyof typeof VOTE],
      }));
      const tallies = { yes: 0, no: 0, abstain: 0, absent: 0 };
      for (const v of votes) tallies[v.vote] += 1;
      return { item: k + 1, tallies, votes };
    }),
  };
};

describe("groupOf / foldedParties", () => {
  const file = day("2024-12-18", { "ГЕРБ-СДС": "y", "ПП – ДБ": "n" });

  it("folds the label to one key per group", () => {
    expect(groupOf(file, 1)).toBe("ГЕРБ-СДС");
    expect(groupOf(file, 2)).toBe("ПП-ДБ");
  });

  it("is undefined for an MP the session files no affiliation for", () => {
    expect(groupOf(file, 99)).toBeUndefined();
    expect(groupOf({ ...file, mpParty: undefined }, 1)).toBeUndefined();
  });

  // majorityFor and pluralityForParty compare an mpParty ENTRY against the group they were
  // asked about, so they must be handed this map and not the raw one. A folded group against
  // a raw map matches nobody: every majority null, every dissent and pair-break gone, at a
  // green build and a full-looking artifact.
  it("returns the whole map folded, memoised per mpParty object", () => {
    expect(foldedParties(file)).toEqual({ "1": "ГЕРБ-СДС", "2": "ПП-ДБ" });
    expect(foldedParties(file)).toBe(foldedParties(file));
  });
});

describe("groupLabels", () => {
  const sessions = [
    day("2025-03-26", { "ГЕРБ - СДС": "yyn" }),
    day("2024-12-18", { "ГЕРБ-СДС": "y" }),
  ];

  it("publishes the spelling covering the most ITEMS, not the first seen", () => {
    // The variant day comes second in the corpus but first alphabetically, and the sessions
    // array is not date-ordered — neither may decide the label.
    expect(groupLabels(sessions).get("ГЕРБ-СДС")).toBe("ГЕРБ - СДС");
    expect(groupLabels([...sessions].reverse()).get("ГЕРБ-СДС")).toBe(
      "ГЕРБ - СДС",
    );
  });

  it("never publishes the uppercased fold key", () => {
    // Every consumer joins on the label — party colours, /votes/between/:pair, the
    // party_pair_breaks key. Emitting keys would rename every group at once.
    expect([...groupLabels(sessions).values()]).toEqual(["ГЕРБ - СДС"]);
  });

  it("does NOT merge two different names", () => {
    const labels = groupLabels([
      day("2024-12-18", { "ДПС - НН": "y", "ДПС - ДПС": "n", ДПС: "a" }),
    ]);
    expect([...labels.keys()].sort()).toEqual(["ДПС", "ДПС-ДПС", "ДПС-НН"]);
  });
});

// The contract that matters more than any single metric: all six bucket the same way and
// publish the same spelling. They are joined by name across artifacts — the heatmap cell
// mints /votes/between/„А--Б" from party_correlation's labels and usePartyPairBreaks looks
// „А__Б" up in party_pair_breaks — so a metric that folds differently does not produce a
// visibly wrong number, it produces an empty page.
describe("every metric agrees on the group and its name", () => {
  const sessions = [
    day("2025-03-26", { "ГЕРБ - СДС": "yyn", "ПП - ДБ": "ynn" }),
    day("2024-12-18", { "ГЕРБ-СДС": "y", "ПП-ДБ": "n" }),
  ];
  const EXPECTED = ["ГЕРБ - СДС", "ПП - ДБ"];

  it("cohesion: one row per group, covering both spellings' items", () => {
    const out = computeCohesion(sessions);
    expect(out.entries.map((e) => e.partyShort).sort()).toEqual(EXPECTED);
    expect(out.entries.map((e) => e.itemsCovered)).toEqual([4, 4]);
    expect([...new Set(out.series.map((s) => s.partyShort))].sort()).toEqual(
      EXPECTED,
    );
  });

  it("loyalty and attendance: the MP wears the published label", () => {
    expect(computeLoyalty(sessions).entries.map((e) => e.partyShort)).toEqual(
      EXPECTED,
    );
    expect(
      computeAttendance(sessions).entries.map((e) => e.partyShort),
    ).toEqual(EXPECTED);
  });

  it("dissents: the majority is computed, not lost to a folded-vs-raw compare", () => {
    const out = computeDissents(sessions);
    expect(out.entries.map((e) => e.partyShort)).toEqual(EXPECTED);
    // A single-member group is always its own majority, so nobody dissents — but every
    // member must have been COUNTED, which is what a folded group against a raw map loses.
    expect(out.entries.map((e) => e.totalCast)).toEqual([4, 4]);
  });

  it("party_correlation: two rows, not four", () => {
    expect(computePartyCorrelation(sessions).parties.sort()).toEqual(EXPECTED);
  });

  it("party_pair_breaks: ONE key, and it is the one the URL resolves to", () => {
    const corr = computePartyCorrelation(sessions);
    const breaks = computePartyPairBreaks(sessions);
    const [a, b] = [...corr.parties].sort();
    // Built from the correlation labels exactly as usePartyPairBreaks' normalizePairKey
    // builds it from the two halves of /votes/between/:pair.
    expect(Object.keys(breaks.pairs)).toEqual([`${a}__${b}`]);
  });
});
