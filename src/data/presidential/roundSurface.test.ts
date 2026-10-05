// The fact strip must describe the round on screen. The producer builds `facts` from round 1,
// so a runoff view that kept them would print round 1's leader share above the runoff result.

import { describe, expect, it } from "vitest";
import type { ElectionSurfaceV1 } from "@/data/elections/surfaceTypes";
import { presidentialRoundSurface, surfaceRounds } from "./roundSurface";

const ballot = (
  round: 1 | 2,
  pct: number,
  margin: number,
  turnout: number,
) => ({
  kind: "presidential_ticket" as const,
  round,
  resultStatus: "final" as const,
  preview: [
    {
      partyId: null,
      localPartyNum: 6,
      candidateName: "Румен Георгиев Радев",
      votes: 100,
      pct,
      marginPct: margin,
    },
  ],
  totals: {
    votesCast: round === 1 ? 82170 : 74903,
    validVotes: round === 1 ? 80245 : 74367,
    turnoutBasis: "registered_voters" as const,
    turnoutPct: turnout,
  },
});

// Pleven, 2021 — the producer's own figures.
const SURFACE = {
  schemaVersion: 1,
  kind: "presidential",
  cycle: "2021_11_14_pvr",
  place: { level: "region", id: "PVN" },
  status: { result: "final", sourceLabel: "cik" },
  ballots: [ballot(1, 61.97, 41.22, 34.98), ballot(2, 75.73, 51.47, 31.83)],
  facts: [
    { code: "winner", value: 61.97, unit: "pct", basis: "valid_votes" },
    { code: "margin", value: 41.22, unit: "pct_point", basis: "valid_votes" },
    { code: "turnout", value: 34.98, unit: "pct", basis: "registered_voters" },
    { code: "valid_votes", value: 80245, unit: "votes", basis: "valid_votes" },
    { code: "paper_machine", value: 55.1, unit: "pct", basis: "valid_votes" },
  ],
  standouts: [],
  destinations: {},
} as unknown as ElectionSurfaceV1;

describe("presidentialRoundSurface", () => {
  it("keeps the producer's facts for the round they were built from", () => {
    const r1 = presidentialRoundSurface(SURFACE, 1);
    expect(r1.ballots.map((b) => b.round)).toEqual([1]);
    expect(r1.facts).toBe(SURFACE.facts);
  });

  it("rebuilds the strip from the runoff ballot, and drops what that ballot cannot answer", () => {
    const r2 = presidentialRoundSurface(SURFACE, 2);
    expect(r2.ballots.map((b) => b.round)).toEqual([2]);
    expect(r2.facts.map((f) => [f.code, f.value])).toEqual([
      ["winner", 75.73],
      ["margin", 51.47],
      ["turnout", 31.83],
      ["valid_votes", 74367],
    ]);
  });

  it("returns the surface unchanged for a round it has no ballot for", () => {
    const one = { ...SURFACE, ballots: [SURFACE.ballots[0]] };
    expect(presidentialRoundSurface(one, 2)).toBe(one);
    expect(surfaceRounds(one)).toEqual([1]);
  });
});
