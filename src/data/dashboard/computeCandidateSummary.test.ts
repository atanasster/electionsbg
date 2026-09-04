// The ONE reducer both candidate surfaces publish every figure from — `/candidate/:id` over
// the name-folder shards and `/person/:slug` over `person_election_stats`. It had no test at
// all: the parity gate beside it asserted `build()` equalled `build()`, which is true of any
// pure implementation including one that returns `{}`, so a reducer that dropped or inverted
// a field would have shipped green.
//
// What is pinned here is the arithmetic a reader sees on both pages — the preference total,
// the deltas against the prior cycle, the share of the party's preferences, the paper/machine
// split, and the region ordering — plus the three UNDEFINED short-circuits, which are the
// half that matters: each one exists so a missing prior cycle renders as "no comparison"
// rather than as a comparison against zero.

import { describe, it, expect } from "vitest";
import { computeCandidateSummary } from "./computeCandidateSummary";
import type { PreferencesInfo } from "../dataTypes";

const findParty = (n: number) =>
  n === 28
    ? { nickName: "БСП", name: "БСП – ОЛ", color: "#ed1c24" }
    : undefined;
const findRegion = (oblast?: string) =>
  oblast === "S24"
    ? { name: "София 24", name_en: "Sofia 24", long_name: "София 24 МИР" }
    : { name: oblast, name_en: oblast };

const row = (over: Partial<PreferencesInfo>): PreferencesInfo => ({
  partyNum: 28,
  oblast: "S24",
  pref: "116",
  totalVotes: 0,
  ...over,
});

const run = (regionRows: PreferencesInfo[], priorElectionName?: string) =>
  computeCandidateSummary({
    name: "Боян Иванов Бойчев",
    selected: "2024_10_27",
    priorElectionName,
    regionRows,
    stats: null,
    findParty,
    findRegion,
  });

describe("computeCandidateSummary", () => {
  it("sums preferences across regions and resolves the party from the FIRST row", () => {
    const s = run([
      row({ oblast: "S24", totalVotes: 18 }),
      row({ oblast: "S23", totalVotes: 7 }),
    ]);
    expect(s.totalVotes).toBe(25);
    expect(s.partyNum).toBe(28);
    expect(s.partyNickName).toBe("БСП");
    expect(s.partyColor).toBe("#ed1c24");
  });

  it("computes the share of the party's preferences, rounded to 2dp", () => {
    // 100 × 18 / 2779 = 0.6477…
    const s = run([row({ totalVotes: 18, partyPrefs: 2779 })]);
    expect(s.partyPrefs).toBe(2779);
    expect(s.pctOfPartyPrefs).toBe(0.65);
  });

  it("leaves the party-preference share UNDEFINED rather than 0 when the ballot published none", () => {
    // A zero denominator is "not published", not "this candidate took 0% of it". Rendering
    // 0% would be a claim about the ballot that the corpus does not make.
    expect(run([row({ totalVotes: 18 })]).pctOfPartyPrefs).toBeUndefined();
    expect(
      run([row({ totalVotes: 18, partyPrefs: 0 })]).pctOfPartyPrefs,
    ).toBeUndefined();
  });

  it("compares against the prior cycle only when the rows carry one", () => {
    const s = run([row({ totalVotes: 18, lyTotalVotes: 76 })], "2024_06_09");
    expect(s.priorElection).toBe("2024_06_09");
    expect(s.priorTotalVotes).toBe(76);
    expect(s.deltaVotes).toBe(-58);
    // 100 × (18 − 76) / 76 = −76.315…
    expect(s.deltaPct).toBe(-76.32);
  });

  it("short-circuits every prior-cycle field when no row carries a prior figure", () => {
    const s = run([row({ totalVotes: 18 })]);
    expect(s.priorTotalVotes).toBeUndefined();
    expect(s.deltaVotes).toBeUndefined();
    expect(s.deltaPct).toBeUndefined();
  });

  it("keeps deltaPct undefined at a zero prior total while still reporting the delta", () => {
    // A candidate going 0 → 18 has a real +18 and no meaningful percentage; dividing by zero
    // would render Infinity%.
    const s = run([row({ totalVotes: 18, lyTotalVotes: 0 })]);
    expect(s.deltaVotes).toBe(18);
    expect(s.deltaPct).toBeUndefined();
  });

  it("builds the paper/machine split with its prior-cycle deltas", () => {
    const s = run([
      row({
        totalVotes: 18,
        paperVotes: 13,
        machineVotes: 5,
        lyPaperVotes: 38,
        lyMachineVotes: 38,
      }),
    ]);
    expect(s.paperMachine).toEqual({
      paperVotes: 13,
      machineVotes: 5,
      total: 18,
      paperPct: 72.22,
      machinePct: 27.78,
      priorPaperPct: 50,
      priorMachinePct: 50,
      deltaPaperPct: 22.22,
      deltaMachinePct: -22.22,
    });
  });

  it("omits the paper/machine split entirely on a cycle that has neither", () => {
    // Every pre-machine cycle. `undefined` is what makes the card self-hide and the grid
    // collapse to 3 columns, so a `{ total: 0 }` here would render an all-zero split.
    expect(run([row({ totalVotes: 18 })]).paperMachine).toBeUndefined();
  });

  it("sorts regions by preferences DESCENDING and resolves each region's labels", () => {
    const s = run([
      row({ oblast: "S23", totalVotes: 7 }),
      row({ oblast: "S24", totalVotes: 18 }),
    ]);
    expect(s.regions.map((r) => r.oblast)).toEqual(["S24", "S23"]);
    expect(s.regions[0].long_name).toBe("София 24 МИР");
    expect(s.regions[0].name_en).toBe("Sofia 24");
  });

  it("derives the three per-region percentages from that region's own denominators", () => {
    const s = run([
      row({
        totalVotes: 18,
        partyPrefs: 2779,
        partyVotes: 8564,
        allVotes: 127436,
      }),
    ]);
    expect(s.regions[0].pctOfPartyPrefs).toBe(0.65);
    expect(s.regions[0].pctOfPartyVotes).toBe(0.21);
    expect(s.regions[0].pctOfRegion).toBe(0.01);
  });

  it("passes the geography and history arrays through, defaulting to empty", () => {
    // These are the raw shard/PG arrays — the reducer must not reshape them, since the same
    // tiles consume them from both feeds.
    const withStats = computeCandidateSummary({
      name: "X",
      selected: "2024_10_27",
      regionRows: [row({ totalVotes: 1 })],
      stats: {
        stats: [{ elections_date: "2022_10_02", preferences: [] }],
        top_settlements: [row({ ekatte: "68134", totalVotes: 1 })],
        top_sections: [row({ section: "244601011", totalVotes: 1 })],
      },
      findParty,
      findRegion,
    });
    expect(withStats.history).toHaveLength(1);
    expect(withStats.topSettlements).toHaveLength(1);
    expect(withStats.topSections).toHaveLength(1);

    const noStats = run([row({ totalVotes: 1 })]);
    expect(noStats.history).toEqual([]);
    expect(noStats.topSettlements).toEqual([]);
    expect(noStats.topSections).toEqual([]);
  });

  it("survives an empty region set without inventing a party", () => {
    // Reachable: a candidacy ROLE with no preference rows (a roster-only entry). `partyNum`
    // falls back to 0, which `findParty` does not resolve — so the badge is absent rather
    // than showing whichever party happens to be numbered 0.
    const s = run([]);
    expect(s.totalVotes).toBe(0);
    expect(s.partyNum).toBe(0);
    expect(s.partyNickName).toBeUndefined();
    expect(s.regions).toEqual([]);
  });
});
