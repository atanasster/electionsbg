import { describe, expect, it } from "vitest";
import { groupElectionRegions } from "./electionGeography";

const region = (key: string, first = 10, second = 5) => ({
  key,
  results: {
    votes: [
      { partyNum: 1, totalVotes: first },
      { partyNum: 2, totalVotes: second },
    ],
  },
});

describe("election geography", () => {
  it("folds the 32 election regions into 28 administrative oblasts", () => {
    const ordinary = [
      "BLG",
      "BGS",
      "VAR",
      "VTR",
      "VID",
      "VRC",
      "GAB",
      "DOB",
      "KRZ",
      "KNL",
      "LOV",
      "MON",
      "PAZ",
      "PER",
      "PVN",
      "RAZ",
      "RSE",
      "SLS",
      "SLV",
      "SML",
      "SFO",
      "SZR",
      "TGV",
      "HKV",
      "SHU",
      "JAM",
    ].map((key) => region(key));
    const grouped = groupElectionRegions(
      [
        ...ordinary,
        region("PDV", 20),
        region("PDV-00", 30),
        region("S23", 40),
        region("S24", 50),
        region("S25", 60),
        region("32", 1_000),
      ],
      "oblast",
    );

    expect(grouped).toHaveLength(28);
    expect(grouped.some((entry) => entry.key === "32")).toBe(false);
    expect(
      grouped
        .find((entry) => entry.key === "PDV")
        ?.results.votes.find((vote) => vote.partyNum === 1)?.totalVotes,
    ).toBe(50);
    expect(
      grouped
        .find((entry) => entry.key === "SOF-CITY")
        ?.results.votes.find((vote) => vote.partyNum === 1)?.totalVotes,
    ).toBe(150);
  });

  it("preserves all electoral districts when MIR is requested", () => {
    const input = [region("S23"), region("S24"), region("32")];
    expect(groupElectionRegions(input, "mir")).toBe(input);
  });
});
