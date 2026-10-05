import { describe, expect, it } from "vitest";
import type {
  PresidentialAgencyError,
  PresidentialCycleAccuracy,
} from "@/data/polls/pollsTypes";
import {
  presidentialAgencyCycles,
  presidentialAgencyStandings,
  presidentialTrendRows,
} from "./presidentialPollAccuracy";

const grade = (
  agencyId: string,
  mae: number,
  daysBefore = 7,
): PresidentialAgencyError => ({
  agencyId,
  pollId: `${agencyId}-${mae}`,
  fieldworkEnd: "2021-11-07",
  daysBefore,
  respondents: null,
  errors: [],
  mae,
  rmse: mae,
  biggestMiss: { key: "x", error: mae },
  leaderCalled: null,
  runoffPairCalled: null,
  decidedInRoundCalled: null,
  runoff: null,
});

const cycle = (
  id: string,
  date: string,
  agencies: PresidentialAgencyError[],
): PresidentialCycleAccuracy => ({
  cycle: id,
  round1Date: date,
  decidedInRound: 2,
  winner: "x",
  actualResults: [],
  agencies,
});

const CYCLES = [
  cycle("2021_11_14_pvr", "2021-11-14", [grade("TR", 1.5), grade("SH", 3.5)]),
  cycle("2006_10_22_pvr", "2006-10-22", []),
  cycle("2016_11_06_pvr", "2016-11-06", [grade("TR", 2.5, 11)]),
];

describe("presidentialTrendRows", () => {
  it("drops ungraded cycles instead of plotting a zero, oldest first", () => {
    const rows = presidentialTrendRows(CYCLES);
    expect(rows.map((r) => r.cycle)).toEqual([
      "2016_11_06_pvr",
      "2021_11_14_pvr",
    ]);
    expect(rows[1]).toMatchObject({ avgMae: 2.5, maxMae: 3.5, agencyCount: 2 });
  });
});

describe("presidentialAgencyStandings", () => {
  it("averages per-cycle grades unweighted and carries the cycle count", () => {
    expect(presidentialAgencyStandings(CYCLES)).toEqual([
      { agencyId: "TR", meanMae: 2, cycles: 2, medianDaysBefore: 9 },
      { agencyId: "SH", meanMae: 3.5, cycles: 1, medianDaysBefore: 7 },
    ]);
  });
});

describe("presidentialAgencyCycles", () => {
  it("lists one agency's graded cycles, newest first", () => {
    expect(
      presidentialAgencyCycles(CYCLES, "TR").map((r) => r.cycle.cycle),
    ).toEqual(["2021_11_14_pvr", "2016_11_06_pvr"]);
    expect(presidentialAgencyCycles(CYCLES, "AR")).toEqual([]);
  });
});
