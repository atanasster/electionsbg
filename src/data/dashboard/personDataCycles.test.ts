import { describe, it, expect } from "vitest";
import {
  hasElectionResults,
  personDataCycles,
  type PersonDonation,
  type PersonElectionRow,
} from "./usePersonElections";
import type { FinancingFromCandidates } from "../dataTypes";

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

describe("the electoral payload's self-funding contract", () => {
  it("feeds CandidateDonationsTile without a cast", () => {
    // The tile's row type is `Omit<FinancingFromCandidates, "name">`, and `FinancingType`
    // declares both money fields REQUIRED. A hand-written `PersonDonation` with
    // `monetary?: number` is therefore strictly wider and not assignable — which would
    // defeat the whole point of re-keying the donations, since the tile could then only be
    // fed through a cast. This assignment is the check; it is a compile-time assertion that
    // happens to run.
    const rows: PersonDonation[] = [
      {
        date: "25.09.2024",
        goal: "Кандидат",
        monetary: 25564.59,
        nonMonetary: 0,
      },
    ];
    const forTile: Omit<FinancingFromCandidates, "name">[] = rows;
    expect(forTile).toHaveLength(1);
  });

  it("types the four self-funding keys as present, not optional", () => {
    // `person_elections()` always emits them (the columns are NOT NULL DEFAULT 0), so a
    // consumer may read them without a guard — and that is exactly why hosting must not ship
    // ahead of the loader: a database whose columns were never filled serves zeros, but one
    // whose 085 predates them serves the keys absent, and the type promises a number.
    //
    // ⚠️ Built WITHOUT a cast on purpose. The fixture above uses
    // `as unknown as PersonElectionRow`, which is why four new required fields landed with
    // `tsc -b` clean and nothing had to satisfy them.
    const row: PersonElectionRow = {
      election: "2024_10_27",
      partyNum: 28,
      totalVotes: 18,
      regions: [],
      history: [],
      topSettlements: [],
      topSections: [],
      donatedMonetaryEur: 511.29,
      donatedNonMonetaryEur: 0,
      donationCount: 1,
      donations: [
        { date: "", goal: "Кандидат", monetary: 511.29, nonMonetary: 0 },
      ],
    };
    expect(row.donationCount).toBe(row.donations.length);
  });
});
