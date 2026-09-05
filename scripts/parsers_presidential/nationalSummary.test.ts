import { describe, expect, it } from "vitest";
import { assertCommitted } from "../lib/assert_committed";
import { aggregateRound } from "./aggregate";
import {
  CIK_ACTIVITY,
  buildNationalSummary,
  type NationalSummary,
} from "./nationalSummary";
import {
  COMMITTED_ROUND_DIRS,
  CYCLES_OLDEST_FIRST,
  corpusRound,
  pct,
} from "./testCorpus";

assertCommitted(...COMMITTED_ROUND_DIRS, "data/settlements.json");

const cache = new Map<string, NationalSummary>();
const summary = (cycle: string): NationalSummary => {
  const hit = cache.get(cycle);
  if (hit) return hit;
  const rounds = [1, 2].map((r) => corpusRound(cycle, r as 1 | 2));
  const s = buildNationalSummary(rounds, rounds.map(aggregateRound));
  cache.set(cycle, s);
  return s;
};

describe("the outcome", () => {
  it("names the right winner in every cycle, all decided in round 2", () => {
    const expected: Record<string, string> = {
      "2001_11_11_pvr": "Георги Седефчов Първанов",
      "2006_10_22_pvr": "Георги Първанов",
      "2011_10_23_pvr": "Росен Асенов Плевнелиев",
      "2016_11_06_pvr": "Румен Георгиев Радев",
      "2021_11_14_pvr": "Румен Георгиев Радев",
    };
    for (const cycle of CYCLES_OLDEST_FIRST) {
      const s = summary(cycle);
      expect(s.decidedInRound, cycle).toBe(2);
      expect(s.winner.president, cycle).toBe(expected[cycle]);
      expect(s.round2Date, cycle).not.toBeNull();
      expect(s.rounds).toHaveLength(2);
    }
  });

  it("carries both art. 93 (3) conditions per round, not just their conjunction", () => {
    // ⚠ 2006 and 2011 each satisfy exactly ONE, so a summary publishing only
    // `winsOutright` could not say WHY either went to a runoff — and „a clear majority
    // that was not enough" is the whole story of 2006.
    const r1 = (c: string) => summary(c).rounds[0].outcome;
    expect(r1("2006_10_22_pvr")).toEqual({
      meetsMajority: true,
      meetsTurnout: false,
      winsOutright: false,
    });
    expect(r1("2011_10_23_pvr")).toEqual({
      meetsMajority: false,
      meetsTurnout: true,
      winsOutright: false,
    });
    expect(r1("2021_11_14_pvr")).toEqual({
      meetsMajority: false,
      meetsTurnout: false,
      winsOutright: false,
    });
  });
});

// ⚠⚠ EVERY FIGURE THAT COULD BE COMPUTED TWO WAYS NAMES WHICH ONE IT IS. That is this
// file's job, not decoration on it.
describe("named bases", () => {
  it("publishes the ticket sum and the valid total as separate numbers", () => {
    const r1 = summary("2021_11_14_pvr").rounds[0];
    expect(r1.votes.tickets).toBe(2_615_149);
    expect(r1.votes.noneOfTheAbove).toBe(60_786);
    expect(r1.votes.valid).toBe(2_675_935);
    // …and the share published is over the VALID votes, the official figure.
    expect(pct(r1.ranking[0].shareOfValid)).toBe("49.42");
    // The ticket-sum denominator would have elected him outright.
    expect(pct(r1.ranking[0].votes / r1.votes.tickets)).toBe("50.57");
  });

  it("leaves „никого“ absent before 2016 rather than writing a zero", () => {
    // ⚠ The form did not ask. A stored 0 claims nobody chose an option nobody was
    // offered, and a consumer computing `valid − никого` would get the right number for
    // the wrong reason.
    for (const cycle of [
      "2001_11_11_pvr",
      "2006_10_22_pvr",
      "2011_10_23_pvr",
    ]) {
      const v = summary(cycle).rounds[0].votes;
      // `hasOwnProperty.call`, not `Object.hasOwn`: the tsconfig lib is below ES2022.
      expect(
        Object.prototype.hasOwnProperty.call(v, "noneOfTheAbove"),
        cycle,
      ).toBe(false);
      expect(v.valid, cycle).toBe(v.tickets);
    }
  });

  it("publishes the protocols' own valid total as a second basis", () => {
    // Never the denominator; carried so a surface can report that the two disagree
    // rather than quietly pick one.
    for (const cycle of CYCLES_OLDEST_FIRST) {
      const v = summary(cycle).rounds[0].votes;
      expect(v.valid - v.validFromProtocols, cycle).toBe(v.validResidue);
      expect(Math.abs(v.validResidue) / v.valid, cycle).toBeLessThan(0.002);
    }
    expect(summary("2011_10_23_pvr").rounds[0].votes.validResidue).toBe(6);
  });

  it("names the turnout basis, and says when it is domestic only", () => {
    for (const cycle of CYCLES_OLDEST_FIRST) {
      const t = summary(cycle).rounds[0].turnout;
      expect(t.registeredBasis, cycle).toBe("protocol-all-forms");
      expect(t.castBasis, cycle).toBe("signatures");
      expect(t.pct, cycle).toBeCloseTo(t.cast / t.registeredVoters, 12);
    }
    // ⚠ 2006's abroad protocols report neither registered voters nor signatures while
    // casting 46,113 valid votes, so its ratio covers the country only.
    expect(summary("2006_10_22_pvr").rounds[0].turnout.basis).toContain(
      "само в страната",
    );
    expect(summary("2021_11_14_pvr").rounds[0].turnout.basis).toContain(
      "включително в чужбина",
    );
  });

  // ⚠ CARRIED BESIDE OURS, NEVER INSTEAD. The page's cast figure matches ours exactly and
  // its registered figure does not, so neither of our bases reproduces its percentage.
  // Dropping it would hide that they disagree; adopting it would mean inventing a third
  // basis nothing derives.
  it("carries ЦИК's own activity figures where the page is archived", () => {
    const t = summary("2021_11_14_pvr").rounds[0].turnout;
    expect(t.cikActivity).toEqual({
      registeredVoters: 6_635_305,
      cast: 2_687_307,
    });
    expect(t.cast, "our cast figure matches the page exactly").toBe(2_687_307);
    expect(t.registeredVoters, "and our registered figure does not").not.toBe(
      6_635_305,
    );
    // …so the two percentages differ, which is the point of publishing both.
    expect(pct(t.pct!)).not.toBe(
      pct(t.cikActivity!.cast / t.cikActivity!.registeredVoters),
    );
  });

  it("omits the ЦИК block for a round with no archived page", () => {
    // ⚠ ABSENT, not zeroed. Only 2021 round 1 is archived; an empty object would read as
    // „the page reported nothing".
    expect(
      summary("2021_11_14_pvr").rounds[1].turnout.cikActivity,
    ).toBeUndefined();
    for (const cycle of CYCLES_OLDEST_FIRST.filter(
      (c) => c !== "2021_11_14_pvr",
    )) {
      expect(
        summary(cycle).rounds[0].turnout.cikActivity,
        cycle,
      ).toBeUndefined();
    }
    expect(Object.keys(CIK_ACTIVITY)).toEqual(["2021_11_14_pvr"]);
  });

  it("names the invalid count as paper-only", () => {
    // ⚠ A machine does not accept an invalid ballot, so this figure is paper in every
    // era — which makes it incomparable across them without its denominator. 2021's is
    // 0.35% of the valid votes and 3.0% of the paper ones, and only the second is a rate
    // anybody means.
    const r1 = summary("2021_11_14_pvr").rounds[0];
    expect(r1.votes.invalidBasis).toBe("paper-ballots-found-invalid");
    // ⚠ PINNED, not bounded. „Less than 0.5% of valid votes" is satisfied by zero, which
    // is exactly the failure — a fold that stopped reading the field would pass it.
    expect(r1.votes.invalid).toBe(9_487);
    // …and the rate that actually means something is against the PAPER votes.
    const paper = corpusRound("2021_11_14_pvr", 1).sections.reduce(
      (a, s) => a + s.votes.reduce((b, v) => b + (v.paperVotes ?? 0), 0),
      0,
    );
    expect((100 * r1.votes.invalid) / (paper + r1.votes.invalid)).toBeCloseTo(
      3.0,
      1,
    );
    for (const cycle of CYCLES_OLDEST_FIRST) {
      expect(summary(cycle).rounds[0].votes.invalidBasis, cycle).toBe(
        "paper-ballots-found-invalid",
      );
    }
  });
});

// ⚠ ONLY THE TICKETS THAT STOOD IN BOTH ROUNDS. A ticket absent from the runoff did not
// lose its votes — it was not on the ballot — and a delta against its round-1 total would
// describe a collapse that never happened.
describe("the round-to-round swing", () => {
  it("covers exactly the two tickets that reached the runoff", () => {
    for (const cycle of CYCLES_OLDEST_FIRST) {
      const s = summary(cycle);
      expect(s.swing, cycle).not.toBeNull();
      expect(s.swing!.tickets, cycle).toHaveLength(2);
      const runoffNumbers = new Set(s.rounds[1].ranking.map((r) => r.number));
      for (const t of s.swing!.tickets) {
        expect(runoffNumbers.has(t.number), `${cycle}/${t.number}`).toBe(true);
      }
    }
  });

  it("never invents a swing for a ticket that was not standing", () => {
    // 2021 had 23 tickets in round 1 and 2 in the runoff, so 21 have no swing at all —
    // and would otherwise each show a delta equal to minus their whole round-1 vote.
    const s = summary("2021_11_14_pvr");
    expect(s.rounds[0].ranking).toHaveLength(23);
    const missing = s.rounds[0].ranking.filter(
      (r) => !s.swing!.tickets.some((t) => t.number === r.number),
    );
    expect(missing).toHaveLength(21);
    // Карадайъ took 309,681 in round 1 and did not stand in the runoff.
    expect(s.swing!.tickets.some((t) => t.president.includes("Карадайъ"))).toBe(
      false,
    );
  });

  it("reports the deltas as the arithmetic they are", () => {
    for (const cycle of CYCLES_OLDEST_FIRST) {
      for (const t of summary(cycle).swing!.tickets) {
        expect(t.deltaVotes, `${cycle}/${t.number}`).toBe(
          t.round2Votes - t.round1Votes,
        );
        expect(t.deltaShare, `${cycle}/${t.number}`).toBeCloseTo(
          t.round2Share - t.round1Share,
          12,
        );
      }
    }
    // ⚠ Both survivors gain votes in every cycle here, since a runoff draws the
    // eliminated candidates' voters. Turnout, by contrast, falls in four of the five —
    // 2001 is the exception, and a summary that assumed either direction would be wrong
    // somewhere.
    for (const cycle of CYCLES_OLDEST_FIRST) {
      for (const t of summary(cycle).swing!.tickets) {
        expect(t.deltaVotes, `${cycle}/${t.number}`).toBeGreaterThan(0);
      }
    }
    expect(summary("2001_11_11_pvr").swing!.turnoutDeltaPct).toBeGreaterThan(0);
    for (const cycle of CYCLES_OLDEST_FIRST.filter(
      (c) => c !== "2001_11_11_pvr",
    )) {
      expect(summary(cycle).swing!.turnoutDeltaPct, cycle).toBeLessThan(0);
    }
  });
});

describe("the swing's join key", () => {
  // ⚠ THE NAME CHECK IS NOT REDUNDANT: 2006's runoff RE-USES the round-1 ticket numbers
  // while 2001's RENUMBERS its survivors, so „ticket 2" is a different person in the two
  // rounds of at least one era here. Joining on the number alone would print round 1's
  // name over round 2's votes with nothing failing.
  it("refuses a runoff whose ticket numbers name different people", () => {
    const rounds = [1, 2].map((r) => corpusRound("2006_10_22_pvr", r as 1 | 2));
    const renamed = {
      ...rounds[1],
      tickets: rounds[1].tickets.map((t) => ({
        ...t,
        president: `${t.president} (друг)`,
      })),
    };
    expect(() =>
      buildNationalSummary(
        [rounds[0], renamed],
        [aggregateRound(rounds[0]), aggregateRound(rounds[1])],
      ),
    ).toThrow(/the ballot was renumbered/);
  });

  it("finds the two eras whose runoff numbering differs", () => {
    // The measurement behind the guard: 2001 renumbers (round 1 tickets 2 and 5 become
    // the runoff's own pair) while 2006 and 2011 keep the round-1 numbers.
    const numbers = (cycle: string, round: 1 | 2) =>
      corpusRound(cycle, round).tickets.map((t) => t.number);
    expect(numbers("2006_10_22_pvr", 2)).toEqual([3, 6]);
    expect(numbers("2011_10_23_pvr", 2)).toEqual([2, 8]);
    expect(numbers("2001_11_11_pvr", 2)).toEqual([2, 5]);
    // …and in every cycle the two survivors keep their round-1 identity, which is what
    // makes the corpus safe today and the guard a control rather than a live fix.
    for (const cycle of CYCLES_OLDEST_FIRST) {
      for (const t of summary(cycle).swing!.tickets) {
        const r1 = summary(cycle).rounds[0].ranking.find(
          (x) => x.number === t.number,
        )!;
        expect(t.president, `${cycle}/${t.number}`).toBe(r1.president);
      }
    }
  });

  it("says whether the two rounds' turnout figures share a basis", () => {
    // ⚠ `turnoutDeltaPct` subtracts two ratios; the flag is what tells a consumer the
    // subtraction is meaningful. In 2006 both rounds are domestic-only, so it is.
    for (const cycle of CYCLES_OLDEST_FIRST) {
      expect(summary(cycle).swing!.turnoutBasesMatch, cycle).toBe(true);
    }
    expect(summary("2006_10_22_pvr").rounds[1].turnout.basis).toContain(
      "само в страната",
    );
  });
});

describe("abroad and the residue", () => {
  it("reports abroad as votes cast, with no registered denominator", () => {
    // ⚠ Decision 6: turnout abroad is votes cast, never a share of a roll. The block
    // carries no `registeredVoters` at all, so a surface cannot compute one by accident.
    for (const cycle of CYCLES_OLDEST_FIRST) {
      const a = summary(cycle).rounds[0].abroad;
      // ⚠ NO `registeredVoters` KEY AT ALL, so a surface cannot compute a turnout
      // percentage abroad by accident — decision 6 says there is no such denominator.
      expect(Object.keys(a).sort()).toEqual([
        "ballotsFound",
        "countries",
        "sections",
        "sectionsWithoutCountry",
        "sectionsWithoutSignatures",
        "ticketVotes",
      ]);
      expect(a.ticketVotes, cycle).toBeGreaterThan(0);
      expect(a.countries, cycle).toBeGreaterThan(40);
      // ⚠ BALLOTS FOUND EXCEEDS TICKET VOTES, by the invalid ballots and „никого" — the
      // two are different questions and the field names say which is which. The old
      // single `votes` field was documented as „votes cast" and carried the smaller one.
      expect(a.ballotsFound, cycle).toBeGreaterThan(a.ticketVotes);
    }
  });

  // ⚠ THE FIRST READER `signaturesUnreported` HAS EVER HAD. The flag was added when the
  // 2006 reader found all 144 of its abroad protocols publishing точка 3 = 0 while
  // casting 46,113 valid votes, and until now nothing in production consumed it — an
  // absent-vs-zero distinction with no consumer is a comment, not a guarantee.
  it("counts the abroad sections that report no signatures at all", () => {
    const a = summary("2006_10_22_pvr").rounds[0].abroad;
    expect(a.sectionsWithoutSignatures).toBe(144);
    expect(a.sectionsWithoutSignatures).toBe(a.sections);
    // …which is why 2006's national turnout says it covers the country only.
    expect(summary("2006_10_22_pvr").rounds[0].turnout.basis).toContain(
      "само в страната",
    );
    // Every other cycle reports them, so the count is 0 and the basis says so.
    for (const cycle of CYCLES_OLDEST_FIRST.filter(
      (c) => c !== "2006_10_22_pvr",
    )) {
      expect(
        summary(cycle).rounds[0].abroad.sectionsWithoutSignatures,
        cycle,
      ).toBe(0);
    }
  });

  it("counts the sections whose country the corpus cannot name", () => {
    // Their votes are inside `votes`; what is missing is only the attribution.
    expect(
      summary("2001_11_11_pvr").rounds[0].abroad.sectionsWithoutCountry,
    ).toBe(22);
    expect(
      summary("2021_11_14_pvr").rounds[0].abroad.sectionsWithoutCountry,
    ).toBe(0);
  });

  it("publishes the refused sections and their votes", () => {
    // ⚠ The summary is where a reader learns how much of the round the per-oblast files
    // do not cover. 2011's refusals are 13.1% of its round 1.
    const u = summary("2011_10_23_pvr").rounds[0].unplaced;
    expect(u.sections).toBe(1_354);
    expect(u.votes).toBe(441_328);
    for (const cycle of CYCLES_OLDEST_FIRST.filter(
      (c) => c !== "2011_10_23_pvr",
    )) {
      expect(summary(cycle).rounds[0].unplaced, cycle).toEqual({
        sections: 0,
        votes: 0,
        basis: "ticket-votes",
      });
    }
  });
});

// ⚠ THE SUMMARY IS BUILT FROM TWO ARRAYS PAIRED BY POSITION, and nothing else in it
// would notice a mispair: the roll-ups and the tallies are read from different arguments,
// so every vote figure stays correct while the abroad and placement blocks describe
// another election entirely.
describe("the rounds and their aggregations must be the same rounds", () => {
  it("refuses an aggregation from another cycle", () => {
    const rounds = [1, 2].map((r) => corpusRound("2021_11_14_pvr", r as 1 | 2));
    const foreign = [1, 2].map((r) =>
      aggregateRound(corpusRound("2016_11_06_pvr", r as 1 | 2)),
    );
    expect(() => buildNationalSummary(rounds, foreign)).toThrow(
      /paired with an aggregation of 2016_11_06_pvr/,
    );
  });

  it("refuses aggregations given in the wrong order", () => {
    const rounds = [1, 2].map((r) => corpusRound("2011_10_23_pvr", r as 1 | 2));
    const reversed = [...rounds].reverse().map(aggregateRound);
    expect(() => buildNationalSummary(rounds, reversed)).toThrow(
      /was paired with an aggregation of 2011_10_23_pvr\/2/,
    );
  });

  it("refuses rounds from two different cycles", () => {
    const mixed = [
      corpusRound("2011_10_23_pvr", 1),
      corpusRound("2016_11_06_pvr", 2),
    ];
    expect(() =>
      buildNationalSummary(mixed, mixed.map(aggregateRound)),
    ).toThrow(/rounds from 2011_10_23_pvr and 2016_11_06_pvr/);
  });

  it("refuses more than two rounds", () => {
    const r = corpusRound("2011_10_23_pvr", 1);
    const three = [r, r, r];
    expect(() =>
      buildNationalSummary(three, three.map(aggregateRound)),
    ).toThrow(/a cycle has one round or two/);
  });
});

describe("refusals", () => {
  it("refuses a mismatched number of rounds and aggregations", () => {
    const r = corpusRound("2011_10_23_pvr", 1);
    expect(() => buildNationalSummary([r], [])).toThrow(
      /1 round\(s\) against 0/,
    );
    expect(() => buildNationalSummary([], [])).toThrow(/0 round\(s\)/);
  });

  it("refuses a cycle whose rule and corpus disagree about the runoff", () => {
    // `decideCycle`'s guard, reached through this builder: round 1 elected nobody, so a
    // summary built from round 1 alone would have to invent an outcome.
    const r = corpusRound("2021_11_14_pvr", 1);
    expect(() => buildNationalSummary([r], [aggregateRound(r)])).toThrow(
      /elects nobody/,
    );
  });
});
