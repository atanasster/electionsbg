import { describe, expect, it } from "vitest";
import { assertCommitted } from "../lib/assert_committed";
import {
  COMMITTED_ROUND_DIRS,
  CYCLES_OLDEST_FIRST,
  corpusRound,
  corpusTally as tally,
  pct,
} from "./testCorpus";
import { decideCycle, tallyRound, type RoundTally } from "./winnerRule";

assertCommitted(...COMMITTED_ROUND_DIRS);

// ⚠⚠ THE TEST THIS RULE EXISTS FOR. A share is taken over the VALID votes, „не подкрепям
// никого" included; the ticket sum is a different, smaller denominator, and in 2021 the
// two disagree ACROSS the constitutional threshold. Any test that passes under both
// implementations is not testing the denominator, so this one computes the wrong answer
// explicitly and requires it to differ.
describe("the majority denominator", () => {
  it("sends Радев to a runoff in 2021, where the ticket sum would elect him", () => {
    const t = tally("2021_11_14_pvr", 1);
    const radev = t.ranking[0];
    expect(radev.president).toBe("Румен Георгиев Радев");
    expect(radev.votes).toBe(1_322_385);

    // The correct denominator, and the official figure.
    expect(t.validVotes).toBe(2_675_935);
    expect(t.ticketVotes).toBe(2_615_149);
    expect(t.noneOfTheAbove).toBe(60_786);
    expect(t.ticketVotes + t.noneOfTheAbove!).toBe(t.validVotes);
    expect(pct(radev.shareOfValid)).toBe("49.42");
    expect(t.meetsMajority, "49.42% is not a majority").toBe(false);

    // The MUTATION: the same votes over the ticket sum cross the threshold.
    const wrong = radev.votes / t.ticketVotes;
    expect(pct(wrong)).toBe("50.57");
    expect(
      radev.votes * 2 > t.ticketVotes,
      "the ticket-sum denominator elects him — this is what the rule must not do",
    ).toBe(true);
    // The two implementations therefore DISAGREE about the outcome, which is what makes
    // this a control rather than a restatement.
    expect(radev.votes * 2 > t.validVotes).toBe(false);
  });

  it("moves 2016 by 1.5 points, in the same direction", () => {
    // The other side of the same rule: 2016's outcome does not turn on it, so this pins
    // that the denominator still CHANGES the number — a rule that had quietly reverted
    // would show up here even though no outcome moved.
    const t = tally("2016_11_06_pvr", 1);
    expect(t.noneOfTheAbove).toBe(214_094);
    expect(t.validVotes).toBe(3_827_650);
    expect(pct(t.ranking[0].shareOfValid), "the official figure").toBe("25.44");
    expect(pct(t.ranking[0].votes / t.ticketVotes)).toBe("26.95");
  });

  // ⚠ ABSENT, not zero. „не подкрепям никого" arrived with the 2016 form, so for the
  // three earlier cycles the field is undefined and the valid votes ARE the ticket sum.
  // A zero here would be a claim that nobody chose an option that was not on the ballot.
  it("has no „никого“ before 2016, and says so by absence", () => {
    for (const cycle of [
      "2001_11_11_pvr",
      "2006_10_22_pvr",
      "2011_10_23_pvr",
    ]) {
      const t = tally(cycle, 1);
      expect(t.noneOfTheAbove, cycle).toBeUndefined();
      expect(t.validVotes, cycle).toBe(t.ticketVotes);
    }
    for (const cycle of ["2016_11_06_pvr", "2021_11_14_pvr"]) {
      expect(tally(cycle, 1).noneOfTheAbove, cycle).toBeGreaterThan(0);
    }
  });
});

// ⚠⚠ BOTH CONDITIONS, AND THE CORPUS SEPARATES THEM. Art. 93 (3) needs a majority of
// valid votes AND a turnout above half. Every cycle here went to a runoff, but 2006 and
// 2011 each satisfy exactly ONE of the two — so an implementation that checked only the
// majority would have elected a president in 2006, and an `||` would have elected one in
// both.
describe("art. 93 (3) — both conditions", () => {
  it("sends 2006 to a runoff on turnout alone, despite a 64% majority", () => {
    const t = tally("2006_10_22_pvr", 1);
    expect(t.ranking[0].president).toBe("Георги Първанов");
    expect(pct(t.ranking[0].shareOfValid)).toBe("64.05");
    expect(t.meetsMajority, "a clear majority").toBe(true);
    expect(t.meetsTurnout, "and it is still not enough").toBe(false);
    expect(t.winsOutright).toBe(false);
    expect(pct(t.turnout!)).toBe("43.88");
  });

  it("sends 2011 to a runoff on the majority alone, despite a 52% turnout", () => {
    const t = tally("2011_10_23_pvr", 1);
    expect(t.meetsTurnout, "turnout cleared the bar").toBe(true);
    expect(t.meetsMajority, "the leader did not").toBe(false);
    expect(t.winsOutright).toBe(false);
    expect(pct(t.turnout!)).toBe("52.28");
    expect(pct(t.ranking[0].shareOfValid)).toBe("40.11");
  });

  it("fails 2021 on both", () => {
    const t = tally("2021_11_14_pvr", 1);
    expect(t.meetsMajority).toBe(false);
    expect(t.meetsTurnout).toBe(false);
    expect(pct(t.turnout!)).toBe("40.30");
  });

  // ⚠⚠ THE CONTROL FOR THE COMPARISON ITSELF, and it must go through `tallyRound`. An
  // earlier version of this test evaluated `50 * 2 > 100` in its own body: it asserted
  // arithmetic rather than the rule, and — measured — flipping BOTH `>` to `>=` in
  // `winnerRule.ts` passed all 284 tests in this directory, because no real round sits
  // at exactly half on either condition. On the comparison that decides whether a
  // president was elected a week early, that is no coverage at all.
  it("requires STRICTLY more than half, on both conditions", () => {
    const real = corpusRound("2011_10_23_pvr", 1);
    // A one-section, two-ticket round contrived so the leader has EXACTLY half the
    // valid votes and EXACTLY half the roll signed.
    const exactlyHalf = tallyRound({
      ...real,
      tickets: real.tickets.slice(0, 2),
      sections: [
        {
          ...real.sections[0],
          protocol: {
            ...real.sections[0].protocol,
            numRegisteredVoters: 100,
            totalActualVoters: 50,
            numValidVotes: 100,
          },
          votes: [
            {
              partyNum: real.tickets[0].number,
              totalVotes: 50,
              paperVotes: 50,
            },
            {
              partyNum: real.tickets[1].number,
              totalVotes: 50,
              paperVotes: 50,
            },
          ],
        },
      ],
    });
    expect(exactlyHalf.validVotes).toBe(100);
    expect(exactlyHalf.ranking[0].votes).toBe(50);
    expect(exactlyHalf.signatures).toBe(50);
    expect(exactlyHalf.registeredVoters).toBe(100);
    // „повече от половината" — a tie is not a win, on either half of the article.
    expect(exactlyHalf.meetsMajority, "exactly half is not a majority").toBe(
      false,
    );
    expect(exactlyHalf.meetsTurnout, "exactly half is not a turnout").toBe(
      false,
    );
    expect(exactlyHalf.winsOutright).toBe(false);
  });

  it("elects on one vote past half, on both conditions", () => {
    // The other side of the boundary, so the guard above cannot be satisfied by a rule
    // that simply never elects anyone.
    const real = corpusRound("2011_10_23_pvr", 1);
    const oneOver = tallyRound({
      ...real,
      tickets: real.tickets.slice(0, 2),
      sections: [
        {
          ...real.sections[0],
          protocol: {
            ...real.sections[0].protocol,
            numRegisteredVoters: 100,
            totalActualVoters: 51,
            numValidVotes: 100,
          },
          votes: [
            {
              partyNum: real.tickets[0].number,
              totalVotes: 51,
              paperVotes: 51,
            },
            {
              partyNum: real.tickets[1].number,
              totalVotes: 49,
              paperVotes: 49,
            },
          ],
        },
      ],
    });
    expect(oneOver.meetsMajority).toBe(true);
    expect(oneOver.meetsTurnout).toBe(true);
    expect(oneOver.winsOutright).toBe(true);
  });
});

describe("decideCycle", () => {
  it("puts every cycle in the corpus into a runoff, and names the winner", () => {
    // All five, and each winner is the runoff's plurality — the runoff has no threshold.
    const expected: Record<string, string> = {
      "2001_11_11_pvr": "Георги Седефчов Първанов",
      "2006_10_22_pvr": "Георги Първанов",
      "2011_10_23_pvr": "Росен Асенов Плевнелиев",
      "2016_11_06_pvr": "Румен Георгиев Радев",
      "2021_11_14_pvr": "Румен Георгиев Радев",
    };
    for (const cycle of CYCLES_OLDEST_FIRST) {
      const o = decideCycle(tally(cycle, 1), tally(cycle, 2));
      expect(o.decidedInRound, cycle).toBe(2);
      expect(o.winner.president, cycle).toBe(expected[cycle]);
      expect(o.runoff, cycle).toBeDefined();
      // The winner comes from the RUNOFF's ranking, not round 1's — they agree in every
      // real cycle here, but 2021 is the case where they need not: Радев led both.
      expect(o.winner.votes, cycle).toBe(o.runoff!.ranking[0].votes);
    }
  });

  // ⚠ Refuses rather than reconciling. Both directions are a disagreement between the
  // computed rule and what the corpus records happened, and silently preferring either
  // would publish an outcome nothing supports.
  it("refuses a round-1 win that nonetheless held a runoff", () => {
    const t = tally("2006_10_22_pvr", 1);
    // Force the outright win the turnout condition denied.
    const elected: RoundTally = {
      ...t,
      meetsTurnout: true,
      winsOutright: true,
    };
    expect(() => decideCycle(elected, tally("2006_10_22_pvr", 2))).toThrow(
      /elects Георги Първанов outright.*yet a runoff was held/s,
    );
  });

  it("refuses a first round that is not round 1, or a runoff that is not round 2", () => {
    expect(() =>
      decideCycle(tally("2021_11_14_pvr", 2), tally("2021_11_14_pvr", 2)),
    ).toThrow(/was given round 2 as its first round/);
    expect(() =>
      decideCycle(tally("2021_11_14_pvr", 1), tally("2021_11_14_pvr", 1)),
    ).toThrow(/was given round 1 as its runoff/);
  });

  it("refuses a runoff from a different election", () => {
    // ⚠ The two tallies are separate arguments, so without this a caller could pair
    // 2016's first round with 2021's runoff and publish a winner who never stood in the
    // election being described — every figure internally consistent.
    expect(() =>
      decideCycle(tally("2016_11_06_pvr", 1), tally("2021_11_14_pvr", 2)),
    ).toThrow(/2016_11_06_pvr and the runoff is 2021_11_14_pvr/);
  });

  it("refuses a cycle that elected nobody and has no runoff", () => {
    expect(() => decideCycle(tally("2021_11_14_pvr", 1))).toThrow(
      /elects nobody.*no runoff was supplied/s,
    );
  });

  it("accepts a round-1 win with no runoff", () => {
    const t = tally("2006_10_22_pvr", 1);
    const o = decideCycle({ ...t, meetsTurnout: true, winsOutright: true });
    expect(o.decidedInRound).toBe(1);
    expect(o.winner.president).toBe("Георги Първанов");
    expect(o.runoff).toBeUndefined();
  });
});

describe("the second valid-vote basis", () => {
  // ⚠ The protocols' own valid total is a DIFFERENT number from the official one, and it
  // is exposed so a surface can report the disagreement rather than quietly pick one. It
  // must never become the denominator: on 2021 it would give 2,677,864 against the
  // published 2,675,935.
  it("differs from the official basis by the known per-round residue", () => {
    const residues: Record<string, number> = {
      "2001_11_11_pvr": -7,
      "2006_10_22_pvr": -8,
      "2011_10_23_pvr": 6,
      "2016_11_06_pvr": 3_913,
      "2021_11_14_pvr": -1_929,
    };
    for (const [cycle, want] of Object.entries(residues)) {
      const t = tally(cycle, 1);
      expect(t.validVotesResidue, cycle).toBe(want);
      expect(t.validVotes - t.protocolValidVotes, cycle).toBe(want);
      // Small enough that it cannot move an outcome, which is why the rule can prefer
      // the official basis without qualification.
      expect(Math.abs(want) / t.validVotes, cycle).toBeLessThan(0.002);
    }
  });

  it("keeps 2006's published valid total reachable, on its own basis", () => {
    // The plan's §2.4 quotes 2,779,381 for 2006, which is the PROTOCOL column — not the
    // ticket sum the rule uses (2,779,373). Both are real; pinned together so nobody
    // „corrects" one into the other.
    const t = tally("2006_10_22_pvr", 1);
    expect(t.protocolValidVotes).toBe(2_779_381);
    expect(t.validVotes).toBe(2_779_373);
  });
});

describe("turnout", () => {
  it("is signatures over registered voters, and never invents a denominator", () => {
    for (const cycle of CYCLES_OLDEST_FIRST) {
      const t = tally(cycle, 1);
      expect(t.turnout, cycle).toBeCloseTo(
        t.signatures / t.registeredVoters,
        12,
      );
      expect(t.registeredVoters, cycle).toBeGreaterThan(6_000_000);
    }
  });

  it("is a DOMESTIC figure in 2006, because abroad reports neither half", () => {
    // ⚠ All 144 abroad sections publish 0 registered and 0 signatures while casting
    // 46,113 valid votes, so they are in neither the numerator nor the denominator. The
    // ratio is therefore unbiased but narrower than the corpus, and a surface must say
    // so rather than calling it national turnout.
    const r = corpusRound("2006_10_22_pvr", 1);
    const abroad = r.sections.filter((s) => s.abroad);
    expect(abroad).toHaveLength(144);
    expect(
      abroad.reduce((a, s) => a + (s.protocol.numRegisteredVoters ?? 0), 0),
    ).toBe(0);
    expect(abroad.reduce((a, s) => a + s.protocol.totalActualVoters, 0)).toBe(
      0,
    );
    expect(
      abroad.reduce((a, s) => a + (s.protocol.numValidVotes ?? 0), 0),
    ).toBe(46_113);
  });

  it("refuses a vote for a ticket that is not on the ballot", () => {
    // ⚠ Such a row would land in `ticketVotes` — and so in the DENOMINATOR of every
    // share — while being dropped from the ranking, lowering every real candidate's
    // percentage against a total nobody can see. The live route is the suemg „99"
    // marker, which is a protocol field and must never arrive as a ticket.
    const r = corpusRound("2011_10_23_pvr", 1);
    expect(() =>
      tallyRound({
        ...r,
        sections: [
          {
            ...r.sections[0],
            votes: [
              ...r.sections[0].votes,
              { partyNum: 99, totalVotes: 500, paperVotes: 500 },
            ],
          },
          ...r.sections.slice(1),
        ],
      }),
    ).toThrow(/votes for ticket 99, which is not on the ballot/);
  });

  it("anchors every cycle's round-1 turnout, and names its basis", () => {
    // ⚠ Pinned as rendered figures rather than recomputed from the same two fields —
    // an assertion that divides the same numerator by the same denominator restates the
    // implementation and cannot fail.
    const expected: Record<string, string> = {
      "2001_11_11_pvr": "41.77",
      "2006_10_22_pvr": "43.88",
      "2011_10_23_pvr": "52.28",
      "2016_11_06_pvr": "57.65",
      "2021_11_14_pvr": "40.30",
    };
    for (const [cycle, want] of Object.entries(expected)) {
      const t = tally(cycle, 1);
      expect(pct(t.turnout!), cycle).toBe(want);
      expect(t.turnoutBasis, cycle).toContain("подписи");
    }
    // Only 2006 says its ratio is domestic-only, because only its abroad sections
    // report neither half.
    expect(tally("2006_10_22_pvr", 1).turnoutBasis).toContain(
      "само в страната",
    );
    expect(tally("2021_11_14_pvr", 1).turnoutBasis).toContain(
      "включително в чужбина",
    );
  });

  it("refuses to tally a round with no valid votes at all", () => {
    const r = corpusRound("2011_10_23_pvr", 1);
    expect(() =>
      tallyRound({
        ...r,
        sections: r.sections.map((s) => ({ ...s, votes: [] })),
      }),
    ).toThrow(/no valid votes, so no share is computable/);
  });

  it("refuses to tally a round with no tickets", () => {
    const r = corpusRound("2011_10_23_pvr", 1);
    expect(() => tallyRound({ ...r, tickets: [] })).toThrow(
      /carries no tickets/,
    );
  });
});
