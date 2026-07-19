import { describe, it, expect } from "vitest";
import {
  hasElectionResults,
  personDataCycles,
  type PersonElectionRow,
} from "./usePersonElections";

const row = (
  election: string,
  totalVotes: number,
  regions: unknown[] = [],
): PersonElectionRow =>
  ({
    election,
    partyNum: 1,
    totalVotes,
    regions,
    history: [],
    topSettlements: [],
    topSections: [],
  }) as unknown as PersonElectionRow;

describe("hasElectionResults", () => {
  it("counts a row with votes or region rows, not a roster-only entry", () => {
    expect(hasElectionResults(row("2021_07_11", 100, [{}]))).toBe(true);
    expect(hasElectionResults(row("2021_07_11", 5, []))).toBe(true);
    expect(hasElectionResults(row("2026_04_19", 0, []))).toBe(false);
  });
});

describe("personDataCycles", () => {
  it("keeps only cycles with results and sorts them newest-first", () => {
    const rows = [
      row("2021_07_11", 100, [{}]),
      row("2026_04_19", 0, []), // roster-only → dropped
      row("2024_10_27", 50, [{}]),
    ];
    expect(personDataCycles(rows)).toEqual(["2024_10_27", "2021_07_11"]);
  });
  it("returns empty when nothing has results", () => {
    expect(personDataCycles([row("2026_04_19", 0, [])])).toEqual([]);
  });
});
