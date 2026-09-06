// Gates for the presidential surfaces.
//
// ⚠ EVERY ASSERTION HERE IS ABOUT A FIGURE THAT WOULD RENDER PERFECTLY IF IT WERE WRONG. A
// turnout published where the corpus cannot support one, a machine share of 0% on an election
// held before machine voting, a ranking whose denominator quietly changed — none of them
// errors, and each is a number a reader believes.

import { describe, expect, it } from "vitest";
import { assertCommitted } from "../lib/assert_committed";
import {
  buildPresidentialSurfaces,
  loadTickets,
  presidentialFacts,
  rankedTickets,
  totalsFrom,
} from "./build_presidential_surface";
import { descriptorFor } from "../../src/screens/elections/electionSurfaceDescriptors";
import {
  SURFACE_BUDGET_BYTES,
  emittedLevels,
} from "../../src/data/elections/surfacePath";
import { serialize } from "./build_surfaces";
import type { ElectionSurfaceV1 } from "../../src/data/elections/surfaceTypes";

assertCommitted("src/data/json/presidential_elections.json");

const CYCLES = [
  "2001_11_11_pvr",
  "2006_10_22_pvr",
  "2011_10_23_pvr",
  "2016_11_06_pvr",
  "2021_11_14_pvr",
];

const cache = new Map<string, ReturnType<typeof buildPresidentialSurfaces>>();
const built = (cycle: string) => {
  const hit = cache.get(cycle);
  if (hit) return hit;
  const b = buildPresidentialSurfaces(cycle);
  cache.set(cycle, b);
  return b;
};
const hasCorpus = built("2021_11_14_pvr").length > 0;
const at = (cycle: string, level: string, id: string): ElectionSurfaceV1 =>
  built(cycle).find((b) => b.level === level && b.id === id)!.surface;

describe.runIf(hasCorpus)("presidential surfaces", () => {
  it("emits every level the policy says emits, and only those", () => {
    // ⚠ DERIVED FROM THE POLICY, not a list. The orchestrator throws when a level emits and
    // has no producer, so this is the other direction — a producer for a level the policy
    // does NOT emit would write objects nothing serves.
    const levels = new Set(built("2021_11_14_pvr").map((b) => b.level));
    expect([...levels].sort()).toEqual(
      [...emittedLevels("presidential")].sort(),
    );
    // …and `country` is the one that does not, because its canonical file is inside budget.
    expect(levels.has("country")).toBe(false);
  });

  it("is inside its budget at every level, which is the point of emitting", () => {
    // The whole-country file a settlement reader would otherwise download is 14.4 MB.
    for (const cycle of CYCLES)
      for (const b of built(cycle)) {
        const budget = SURFACE_BUDGET_BYTES[b.level];
        expect(
          Buffer.byteLength(serialize(b.surface)),
          `${cycle}/${b.level}/${b.id}`,
        ).toBeLessThan(budget);
      }
  });

  it("carries one ballot per round, each stating its own round", () => {
    // ⚠ All six presidential levels declare the `round` ranked column and `ballotFillsColumn`
    // gates it on this field — omit it and the column is dropped silently, on the one kind
    // whose whole shape is „round 1 decided nothing".
    const s = at("2021_11_14_pvr", "region", "BGS");
    expect(s.ballots.map((b) => b.round)).toEqual([1, 2]);
    for (const b of s.ballots) expect(b.kind).toBe("presidential_ticket");
    // …and the two rounds are different elections at the same place, so their figures differ.
    expect(s.ballots[0].totals.validVotes).not.toBe(
      s.ballots[1].totals.validVotes,
    );
  });

  it("ranks a PERSON, with the ballot number and no party id", () => {
    // ⚠ A ticket's nominator may be a party, a coalition or an инициативен комитет — three
    // legally distinct things — so resolving it to a canonical party id would label two of
    // them wrongly on a page about a named person.
    const rows = at("2021_11_14_pvr", "region", "BGS").ballots[0].preview;
    expect(rows[0].partyId).toBeNull();
    expect(rows[0].candidateName).toBe("Румен Георгиев Радев");
    expect(rows[0].localPartyNum).toBe(6);
    // The names are Bulgarian in both languages and never transliterated (§5.3).
    for (const r of rows) expect(r.candidateName).toMatch(/[Ѐ-ӿ]/);
  });

  it("publishes NO turnout abroad, in every cycle", () => {
    // ⚠ DEFINITIONAL, not arithmetic (decision 6). Almost everyone joins the list at the
    // section on the day, so the rate measures a registration regime — and it does not look
    // absurd: the underlying figures render 87–98%, with the shared `cast > denom` guard
    // never firing.
    for (const cycle of CYCLES)
      for (const b of built(cycle).filter((x) => x.level === "abroad"))
        for (const ballot of b.surface.ballots) {
          expect(ballot.totals.turnoutBasis, `${cycle}/${b.id}`).toBe(
            "unavailable",
          );
          expect(
            b.surface.facts.map((f) => f.code),
            `${cycle}/${b.id}`,
          ).not.toContain("turnout");
        }
    // The control: a domestic place DOES publish one, so the assertion is not passing because
    // nothing anywhere has a rate.
    expect(
      at("2021_11_14_pvr", "region", "BGS").facts.map((f) => f.code),
    ).toContain("turnout");
  });

  it("withholds turnout where a place has NO signature numerator at all", () => {
    // ⚠ БОБОШЕВО 2011 is all eleven of its own sections: 17 registered, 0 signatures, 1,812
    // ticket votes. Published, it is 0.00% turnout for a municipality that voted. The SHARED
    // rule catches it — „more valid votes than voters is impossible" — which is why this file
    // adds no clause of its own for it.
    const knl05 = at("2011_10_23_pvr", "municipality", "KNL05");
    expect(knl05.ballots[0].totals.turnoutBasis).toBe("unavailable");
    expect(knl05.facts.map((f) => f.code)).not.toContain("turnout");
    // …and its votes are real, so the page still ranks them.
    expect(knl05.ballots[0].totals.validVotes).toBeGreaterThan(1_000);
    // ⚠ THE CONTROL, AND THE DECISION IT PINS. Its own oblast folds those eleven sections and
    // 267 that DO report — a 4.0% partial gap — and keeps its rate rather than losing turnout
    // for a whole oblast. Measured across all five cycles there are exactly two such places
    // (KNL 2011 at 4.0%, S23 2016 at 0.2%) and eleven full gaps, every one of which the
    // shared guard refuses.
    expect(
      at("2011_10_23_pvr", "region", "KNL").ballots[0].totals.turnoutBasis,
    ).toBe("registered_voters");
    expect(
      at("2016_11_06_pvr", "region", "S23").ballots[0].totals.turnoutBasis,
    ).toBe("registered_voters");
  });

  it("states a machine share only where the cycle had machines", () => {
    // ⚠ Machine votes are 0 corpus-wide for 2001, 2006 and 2011. A rendered „0% машинно"
    // presents an ABSENT TECHNOLOGY as a measured share — rule 2 of the surface contract.
    for (const cycle of ["2001_11_11_pvr", "2006_10_22_pvr", "2011_10_23_pvr"])
      for (const b of built(cycle))
        expect(
          b.surface.facts.map((f) => f.code),
          `${cycle}/${b.level}/${b.id}`,
        ).not.toContain("paper_machine");
    // ⚠ THE CONTROL, AND IT WAS A TAUTOLOGY — `expect(x || true).toBe(true)` passes for every
    // x, so the sweep above was asserting that a rule which never fires never fires. 2021 must
    // actually carry the fact.
    const with2021 = built("2021_11_14_pvr").filter((b) =>
      b.surface.facts.some((f) => f.code === "paper_machine"),
    );
    expect(with2021.length).toBeGreaterThan(1_000);
    // ⚠ AND A MACHINE NOBODY USED IS A MEASURED 0%, not an absence. 22 sections across 2016
    // and 2021 have a machine present and zero machine votes; a rule keyed on the vote TOTAL
    // dropped the fact on every one of them, leaving three facts where the level declares
    // four. This is the other direction of the same distinction.
    const zeroWithMachine = built("2021_11_14_pvr").filter(
      (b) =>
        b.level === "section" &&
        b.surface.facts.some(
          (f) => f.code === "paper_machine" && f.value === 0,
        ),
    );
    expect(zeroWithMachine.length).toBeGreaterThan(0);
  });

  it("states votes cast where the signatures are missing but the ballots are not", () => {
    // ⚠⚠ 48 ABROAD SURFACES OF 2006 PUBLISHED „0 гласували" beside a positive valid-vote
    // count. `ProtocolSum.signatures` is a `number`, so the shared rule's own `?? validVotes`
    // fallback can never fire on it — and `votes_cast` is SECOND in the abroad fact priority,
    // so the zero rendered. The true figure is `ballotsFound`, in the same struct, and
    // §2.5-3 already prescribes exactly that fallback for this population.
    for (const b of built("2006_10_22_pvr").filter(
      (x) => x.level === "abroad",
    )) {
      const cast = b.surface.facts.find((f) => f.code === "votes_cast");
      const valid = b.surface.ballots[0].totals.validVotes;
      if (valid === 0) continue;
      expect(cast?.value, `2006 abroad ${b.id}`).toBeGreaterThan(0);
      // …and it is at least the valid votes, because every valid vote was a ballot found.
      expect(cast!.value, `2006 abroad ${b.id}`).toBeGreaterThanOrEqual(valid);
    }
    // The control: the population is non-empty, so the loop is not vacuous.
    expect(
      built("2006_10_22_pvr").filter((x) => x.level === "abroad").length,
    ).toBeGreaterThan(40);
  });

  it("gives no page to the abroad bucket with no country", () => {
    // ⚠ IT IS A REAL BUCKET — sections whose country the corpus cannot name still cast real
    // votes, and the roll-up keeps them under a `""` key so nothing is silently dropped. What
    // it has no claim to is a PAGE, because there is no place to name on it.
    for (const cycle of CYCLES)
      expect(
        built(cycle).filter((b) => b.level === "abroad" && b.id === ""),
        cycle,
      ).toEqual([]);
  });

  it("rebuilds byte-identically", () => {
    // §9. A generator that stamped `new Date()` would fail this — or make it vacuous.
    const a = buildPresidentialSurfaces("2006_10_22_pvr").map((b) =>
      serialize(b.surface),
    );
    const b = buildPresidentialSurfaces("2006_10_22_pvr").map((x) =>
      serialize(x.surface),
    );
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(1_000);
  });
});

describe("the ranking's denominator", () => {
  it("is the ticket sum, so shares fall short of 100 exactly by „никого“", () => {
    // ⚠ THE SHARES ARE OF THE TICKET SUM, matching `validVotesOf` — the only figure a ranking
    // can add up to. „не подкрепям никого" is a valid vote and is NOT in it, so on a 2016+
    // cycle the column sums to just under 100. The constitutional test uses the wider
    // denominator and lives in `national_summary.json`; conflating the two is the §2.4 trap
    // that elects Радев outright.
    const tickets = loadTickets("2021_11_14_pvr");
    const votes = [
      { partyNum: 1, totalVotes: 60, paperVotes: 60, machineVotes: 0 },
      { partyNum: 6, totalVotes: 40, paperVotes: 40, machineVotes: 0 },
    ];
    const rows = rankedTickets(votes, tickets, 100);
    expect(rows.map((r) => r.pct)).toEqual([60, 40]);
    expect(rows[0].marginPct).toBe(20);
    // A zero-vote row is dropped rather than ranked last at 0% — it is not a result.
    expect(
      rankedTickets([...votes, { partyNum: 2, totalVotes: 0 }], tickets, 100),
    ).toHaveLength(2);
  });

  it("suppresses a rate for a protocol that disagrees with itself", () => {
    // ⚠ IMPORTED, NOT RESTATED. `ballotTotalsFrom` carries the guards a presidential-only
    // copy would lose; these two prove they are reached through this file.
    const votes = [{ partyNum: 1, totalVotes: 200 }];
    const base = {
      sections: 1,
      additionalVoters: 0,
      sectionsWithoutSignatures: 0,
      ballotsFound: 200,
      invalidBallots: 0,
      turnoutBasis: "registered-voters" as const,
    };
    // More valid votes than voters — impossible, so no rate.
    expect(
      totalsFrom({ ...base, registeredVoters: 500, signatures: 100 }, votes)
        .turnoutBasis,
    ).toBe("unavailable");
    // More voters than the roll — the overflow guard.
    expect(
      totalsFrom({ ...base, registeredVoters: 100, signatures: 300 }, votes)
        .turnoutBasis,
    ).toBe("unavailable");
    // …and a self-consistent one DOES get a rate, so the two above are not passing on a rule
    // that refuses everything.
    expect(
      totalsFrom({ ...base, registeredVoters: 500, signatures: 300 }, votes)
        .turnoutPct,
    ).toBe(60);
  });

  it("takes the facts a level declares, in its order, and no more", () => {
    const totals = {
      votesCast: 300,
      validVotes: 200,
      registeredVoters: 500,
      turnoutPct: 60,
      turnoutBasis: "registered_voters" as const,
    };
    const ranked = [
      { partyId: null, votes: 120, pct: 60, marginPct: 20 },
      { partyId: null, votes: 80, pct: 40 },
    ];
    const d = descriptorFor("presidential", "region");
    const facts = presidentialFacts("region", totals, ranked);
    expect(facts.length).toBeLessThanOrEqual(d.available ? d.maxFacts : 0);
    expect(facts.map((f) => f.code)).toEqual([
      "winner",
      "margin",
      "turnout",
      "valid_votes",
    ]);
    // ⚠ The country level leads with the constitutional test and no other level may state it.
    expect(
      presidentialFacts("region", totals, ranked).map((f) => f.code),
    ).not.toContain("majority_threshold");
  });
});
