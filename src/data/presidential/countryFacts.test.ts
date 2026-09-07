// The country strip's PRODUCER — every case here is a card that would look right.
//
// „Мнозинство · 1 337 968" on a RUNOFF is a real number under a threshold the constitution does
// not apply there; „Избирателна активност · 0%" on 2006 is a working card asserting nobody
// voted; and a fifth card is a band that no longer matches the one `/parliamentary` draws.

import { describe, expect, it } from "vitest";
import { descriptorFor } from "@/screens/elections/electionSurfaceDescriptors";
import { majorityVotes, presidentialCountryFacts } from "./countryFacts";
import type { PresidentialSummaryRound } from "./summary";

const ROUND: PresidentialSummaryRound = {
  round: 1,
  date: "2021-11-14",
  ranking: [
    {
      number: 6,
      president: "Румен Георгиев Радев",
      vicePresident: "Илияна Малинова Йотова",
      nominatedBy: { name: "ИК за Румен Радев", kind: "committee" },
      votes: 1_322_385,
      shareOfValid: 0.4942,
    },
    {
      number: 15,
      president: "Анастас Георгиев Герджиков",
      vicePresident: "Невяна Михайлова Митева-Матеева",
      nominatedBy: { name: "ИК за Анастас Герджиков", kind: "committee" },
      votes: 610_862,
      shareOfValid: 0.2283,
    },
  ],
  votes: {
    tickets: 2_615_149,
    noneOfTheAbove: 60_786,
    valid: 2_675_935,
    invalid: 9_487,
    invalidBasis: "paper-ballots-found-invalid",
  },
  turnout: {
    registeredVoters: 6_667_895,
    cast: 2_687_307,
    pct: 0.403,
    basis: "подписи в списъците",
  },
  outcome: { meetsMajority: false, meetsTurnout: false, winsOutright: false },
  abroad: {
    sections: 750,
    ticketVotes: 220_660,
    ballotsFound: 230_243,
    countries: 68,
    sectionsWithoutCountry: 0,
    sectionsWithoutSignatures: 0,
  },
};

const codesOf = (r: PresidentialSummaryRound) =>
  presidentialCountryFacts(r).map((f) => f.code);

describe("majorityVotes", () => {
  it("is MORE than half, at both parities", () => {
    // ⚠ THE TIE IS THE CASE THAT MATTERS. On an even total „at least half" and „more than half"
    // differ by one vote, and the vote they differ on is exactly the one art. 93 (3) refuses to
    // call a win.
    expect(majorityVotes(100)).toBe(51);
    expect(majorityVotes(101)).toBe(51);
    expect(majorityVotes(2_675_935)).toBe(1_337_968);
  });
});

describe("the presidential country strip", () => {
  it("leads with the majority test on round 1", () => {
    // §The descriptor's own rule: on round 1 the leader's share is not the outcome, and a strip
    // that opened with „Радев 49.42%" would read as a win.
    expect(codesOf(ROUND)[0]).toBe("majority_threshold");
    const majority = presidentialCountryFacts(ROUND)[0];
    expect(majority.value).toBe(1_337_968);
    expect(majority.unit).toBe("votes");
    expect(majority.basis).toBe("valid_votes");
  });

  it("states NO majority threshold on the runoff", () => {
    // ⚠ ART. 93 (4) HAS NO MAJORITY TEST — whichever pair takes more votes is elected. A
    // „Мнозинство" card there states a threshold that does not apply to the result beneath it,
    // and it would look exactly like the round-1 one.
    const runoff: PresidentialSummaryRound = {
      ...ROUND,
      round: 2,
      outcome: { meetsMajority: true, meetsTurnout: false, winsOutright: true },
    };
    expect(codesOf(runoff)).not.toContain("majority_threshold");
    expect(codesOf(runoff)).not.toContain("runoff_pending");
    expect(codesOf(runoff)[0]).toBe("winner");
  });

  it("drops the turnout card rather than publishing 0%", () => {
    // ⚠ `null` IS „THE CORPUS CANNOT SUPPORT A RATE" — 2006's 144 abroad sections report
    // neither a roll nor a signature count while casting 46,113 valid votes. A zero would be a
    // claim that nobody voted, on a page whose next card counts 2.6 million votes.
    const noRate: PresidentialSummaryRound = {
      ...ROUND,
      turnout: { ...ROUND.turnout, pct: null },
    };
    expect(codesOf(ROUND)).toContain("turnout");
    expect(codesOf(noRate)).not.toContain("turnout");
    // …and the card it makes room for is the next DECLARED one, never a made-up fifth.
    expect(codesOf(noRate)).toEqual(
      expect.arrayContaining(["majority_threshold", "winner", "valid_votes"]),
    );
  });

  it("publishes the leader's share as a percentage of the VALID votes", () => {
    // The schema's `pct` unit is a percentage; `shareOfValid` is a fraction of 1, and shipping
    // the fraction renders „0.49%" beside a 1.3-million-vote leader.
    const winner = presidentialCountryFacts(ROUND).find(
      (f) => f.code === "winner",
    )!;
    expect(winner.value).toBeCloseTo(49.42, 2);
    expect(winner.unit).toBe("pct");
    expect(winner.basis).toBe("valid_votes");
  });

  it("names no party on any card", () => {
    // ⚠ A TICKET HAS NO `partyId` — its nominator may be a party, a coalition or an
    // инициативен комитет — so a `labelParams.partyId` here would make `ElectionFactsGrid`
    // resolve a party name onto „Първи" and label two of the three wrongly.
    for (const f of presidentialCountryFacts(ROUND))
      expect(f.labelParams?.partyId).toBeUndefined();
  });

  it("obeys the LEVEL's declared order and cap rather than its own", () => {
    // ⚠ THE DESCRIPTOR DECIDES, not this producer — the same contract the generator reads for
    // every level below the country. A strip that hard-coded four codes would keep rendering
    // them after the descriptor dropped one, on the one page with no artifact to disagree with.
    const d = descriptorFor("presidential", "country");
    if (!d.available) throw new Error("the country level must be available");
    const codes = codesOf(ROUND);
    expect(codes.length).toBeLessThanOrEqual(d.maxFacts);
    const priority = [...d.factPriority];
    expect(codes).toEqual(
      [...codes].sort((a, b) => priority.indexOf(a) - priority.indexOf(b)),
    );
    for (const c of codes) expect(priority).toContain(c);
  });

  it("has a runoff card to fall back on when an earlier fact is absent", () => {
    // `runoff_pending` sits FIFTH in a four-card band, so it reaches the strip only when
    // something above it could not be produced — which is the right precedence, and is also why
    // asserting it needs a round with a hole in it rather than the ordinary one.
    const noRate: PresidentialSummaryRound = {
      ...ROUND,
      turnout: { ...ROUND.turnout, pct: null },
    };
    const runoff = presidentialCountryFacts(noRate).find(
      (f) => f.code === "runoff_pending",
    );
    expect(runoff).toBeDefined();
    // ⚠ QUALITATIVE — no value, so the card renders label-only. A number here would be one
    // nobody could name the unit of.
    expect(runoff!.value).toBeUndefined();
    expect(runoff!.unit).toBe("none");
    // …and it is absent once the round HAS a winner, which is what makes it discriminate.
    const decided: PresidentialSummaryRound = {
      ...noRate,
      outcome: { meetsMajority: true, meetsTurnout: true, winsOutright: true },
    };
    expect(codesOf(decided)).not.toContain("runoff_pending");
  });
});
