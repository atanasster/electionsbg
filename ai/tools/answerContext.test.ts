import { expect, it } from "vitest";
import { answerElection } from "./answerContext";
import type { Envelope } from "./types";
const answer = (provenance: string[]): Envelope => ({
  tool: "turnout",
  title: "Turnout",
  kind: "scalar",
  viz: "none",
  facts: {},
  provenance,
});
it("prefers the actual data contest over a stale argument", () => {
  expect(
    answerElection(
      answer(["2024_10_27/summary.json", "2024_10_27/regions.json"]),
      { election: "2023_04_02" },
    ),
  ).toBe("2024_10_27");
});
it("does not pick a single snapshot for a multi-contest answer", () => {
  expect(
    answerElection(answer(["2024_10_27/a.json", "2023_04_02/a.json"]), {
      election: "2024_10_27",
    }),
  ).toBeUndefined();
});
it("uses an explicit contest when the answer has no date provenance", () => {
  expect(answerElection(answer([]), { election: "2024_10_27" })).toBe(
    "2024_10_27",
  );
});
it("does not treat local or presidential provenance as a parliamentary contest", () => {
  expect(
    answerElection(
      answer(["2023_10_29_mi/summary.json", "2021_11_14_pvr/summary.json"]),
    ),
  ).toBeUndefined();
});
