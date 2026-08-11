// The spelling fold, pinned against the shape that motivated it: the 51st NS files
// sixteen days as „ГЕРБ-СДС"/„ПП-ДБ" and the rest as „ГЕРБ - СДС"/„ПП - ДБ", which before
// this made one group two rows — the dominant one's vector missing the variant days, the
// duplicate's a 177-item stub voting alongside it.

import { describe, expect, it } from "vitest";
import { computePartyCorrelation } from "./party_correlation";
import type { SessionFile } from "./types";

/** One plenary day: `spellings` maps a group's label on that day to how its members voted
 *  on each item, one character per item ("y" yes, "n" no, "a" abstain, "-" absent). */
const day = (date: string, spellings: Record<string, string>): SessionFile => {
  const labels = Object.keys(spellings);
  const items = spellings[labels[0]].length;
  const mpParty: Record<string, string> = {};
  labels.forEach((label, i) => (mpParty[String(i + 1)] = label));
  return {
    ns: "51",
    date,
    sessions: Array.from({ length: items }, (_, k) => ({
      item: k + 1,
      title: `item ${k + 1}`,
      votes: labels.map((label, i) => ({
        mpId: i + 1,
        vote: { y: "yes", n: "no", a: "abstain", "-": "absent" }[
          spellings[label][k]
        ] as "yes" | "no" | "abstain" | "absent",
      })),
    })),
    mpParty,
  } as unknown as SessionFile;
};

describe("computePartyCorrelation", () => {
  const sessions = [
    // The dominant spelling — three items.
    day("2025-03-26", { "ГЕРБ - СДС": "yyn", "ПП - ДБ": "ynn", ИТН: "yny" }),
    // The variant — one item, and one the dominant row would otherwise never see.
    day("2024-12-18", { "ГЕРБ-СДС": "y", "ПП-ДБ": "n", ИТН: "y" }),
  ];
  const out = computePartyCorrelation(sessions);

  it("files both spellings of one group as one row", () => {
    expect(out.parties).toHaveLength(3);
    expect(out.parties).not.toContain("ГЕРБ-СДС");
    expect(out.parties).not.toContain("ПП-ДБ");
  });

  it("gives that row the variant day's items", () => {
    // 3 + 1, not 3 — the missing 4.6% in the real artifact is this, at scale.
    expect(out.participation["ГЕРБ - СДС"]).toBe(4);
    expect(out.participation["ПП - ДБ"]).toBe(4);
  });

  it("labels the row with the spelling that carried the most items", () => {
    // Never the uppercased fold key: the artifact keeps the source's own typography.
    expect(out.participation).toHaveProperty("ГЕРБ - СДС");
    expect(out.parties[out.parties.indexOf("ИТН")]).toBe("ИТН");
  });

  it("keys participation with the same labels as the rows", () => {
    expect(Object.keys(out.participation).sort()).toEqual(
      [...out.parties].sort(),
    );
  });

  it("scores the pair over BOTH days, not just the dominant spelling's", () => {
    const i = out.parties.indexOf("ГЕРБ - СДС");
    const j = out.parties.indexOf("ПП - ДБ");
    // Agree on item 1 (y/y) and item 3 (n/n), differ on 2 (y/n) and on the variant day
    // (y/n). Dropping the variant day would leave 3 items and a different cosine.
    expect(out.matrix[i][j]).toBeCloseTo(0, 4);
    expect(out.matrix[i][j]).toBe(out.matrix[j][i]);
  });

  // The half of the rule that keeps the fold honest — ДПС–Ново начало is one side of a
  // split, and the 51st seats it beside „ДПС - ДПС". Merging them would draw one group
  // over a party that had come apart.
  it("does NOT merge two different names", () => {
    const split = computePartyCorrelation([
      day("2024-12-18", {
        "ДПС - НН": "yy",
        "ДПС - ДПС": "nn",
        ДПС: "ya",
      }),
    ]);
    expect(split.parties.sort()).toEqual(["ДПС", "ДПС - ДПС", "ДПС - НН"]);
  });
});
