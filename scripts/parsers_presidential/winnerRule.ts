// Who won, and in which round — Constitution art. 93 (3).
//
// A ticket is elected in round 1 when it takes MORE THAN HALF of the valid votes AND
// MORE THAN HALF of the registered voters took part. Both, not either. Otherwise the top
// two go to a runoff a week later, which the plurality wins.
//
// ⚠⚠ THE DENOMINATOR IS THE VALID VOTES, „НЕ ПОДКРЕПЯМ НИКОГО" INCLUDED, AND THE TICKET
// SUM IS THE WRONG ONE. This is not a rounding preference — it changes an outcome. In
// 2021 round 1, Радев's 1,322,385 is:
//
//     50.57%  of the 2,615,149 ticket votes          → elected outright
//     49.42%  of the 2,675,935 valid votes           → runoff        ← the official result
//
// A parser summing the ticket rows would have declared him president a week early. 2016
// confirms it from the other side: 25.44% with the 214,094 „никого" ballots in the
// denominator, 26.95% without. `validVotes` below is therefore `ticketVotes +
// noneOfTheAbove`, which reproduces BOTH published figures exactly.
//
// ⚠ AND THE TWO CONDITIONS ARE INDEPENDENT — every cycle in the corpus went to a runoff,
// but not for the same reason, which is what a „majority = win" shortcut gets wrong:
//
//     2006   64.05% of valid votes, 43.88% turnout   → runoff on TURNOUT alone
//     2011   40.11% of valid votes, 52.28% turnout   → runoff on the MAJORITY alone
//     2021   49.42% of valid votes, 40.30% turnout   → runoff on both
//
// Plan: docs/plans/presidential-elections-v1.md decision 5, §2.4, T2.6.

import type { PresidentialRound } from "./types";

/** One ticket's standing in a round. */
export interface TicketStanding {
  number: number;
  president: string;
  vicePresident: string;
  votes: number;
  /** Of the VALID votes — see the banner. */
  shareOfValid: number;
}

/** What a round measured, and what art. 93 (3) makes of it. */
export interface RoundTally {
  cycle: string;
  round: 1 | 2;
  date: string;
  /** Best first. Ties keep the lower ticket number, so the order is deterministic. */
  ranking: TicketStanding[];
  /** Σ the ticket rows. ⚠ NOT the denominator of a share. */
  ticketVotes: number;
  /**
   * „не подкрепям никого". ⚠ ABSENT, not 0, before 2016 — the option did not exist, and
   * a stored zero would claim nobody chose it.
   */
  noneOfTheAbove?: number;
  /** `ticketVotes + noneOfTheAbove`. The denominator of every share here. */
  validVotes: number;
  /**
   * The protocols' OWN valid total, `Σ (numValidVotes + numValidMachineVotes) +
   * noneOfTheAbove` — a second, independent basis.
   *
   * ⚠ It is NOT the official one and must never become the denominator: for 2021 it is
   * 2,677,864 against the published 2,675,935. It is here so a surface can report that
   * the two disagree instead of quietly picking one. See `validVotesResidue`.
   */
  protocolValidVotes: number;
  /**
   * `validVotes − protocolValidVotes`. Small and real: ЦИК's own per-section
   * inconsistencies, which the national totals reproduce because ЦИК publishes the same
   * per-ticket sums. Measured over round 1: 2001 −7, 2006 −8, 2011 **+6**, 2016 +3,913,
   * 2021 −1,929 — the sign is not constant, so nothing may treat this as a one-way
   * under-count.
   */
  validVotesResidue: number;
  registeredVoters: number;
  /** Signatures in the rolls — the turnout numerator. */
  signatures: number;
  /**
   * `signatures / registeredVoters`, or null when the corpus cannot support one.
   *
   * ⚠ NAME THIS BASIS WHEREVER IT IS RENDERED. It is not the figure ЦИК's activity page
   * prints — that page counts registration differently — and in 2006 it is a DOMESTIC
   * statistic, because all 144 abroad sections report neither registered voters nor
   * signatures while casting 46,113 valid votes.
   */
  turnout: number | null;
  /**
   * What `turnout` is a ratio OF, in words, for a surface to print beside it.
   *
   * ⚠ The instruction „name this basis" is useless without something to name, and a
   * caller inventing its own wording is how two pages end up describing one number
   * differently. 2006 gets its own sentence because its ratio excludes the country's
   * abroad sections entirely.
   */
  turnoutBasis: string;
  /**
   * The same fact as a CODE, for a consumer that must not print the sentence.
   *
   * ⚠ IT EXISTS BECAUSE `build_catalogue.ts` WAS SUBSTRING-MATCHING THE PROSE. Rewording
   * that sentence — a copy edit, „единствено в страната" — would silently reclassify 2006
   * as national and caption a domestic-only rate as covering everyone, which is the exact
   * defect the distinction was created to prevent. The sentence stays for surfaces that
   * print it; this is what a machine reads.
   */
  turnoutScope: "all-sections" | "domestic-only";
  /** Whether the leader took more than half the valid votes. */
  meetsMajority: boolean;
  /** Whether more than half the registered voters took part. */
  meetsTurnout: boolean;
  /** Art. 93 (3): both conditions, or neither counts. */
  winsOutright: boolean;
}

const sum = (
  r: PresidentialRound,
  f: (s: PresidentialRound["sections"][number]) => number,
): number => r.sections.reduce((a, s) => a + f(s), 0);

/**
 * Measure a round and apply art. 93 (3) to it.
 *
 * @param r - A round as read by its era's reader.
 * @throws If the round carries no tickets or no valid votes — a share with a zero
 *   denominator is not a small number, it is not a number, and publishing one as 0%
 *   would read as „nobody voted for anyone".
 */
export const tallyRound = (r: PresidentialRound): RoundTally => {
  if (!r.tickets.length) {
    throw new Error(
      `winnerRule: ${r.cycle} round ${r.round} carries no tickets`,
    );
  }

  const onBallot = new Set(r.tickets.map((t) => t.number));
  const byTicket = new Map<number, number>();
  for (const s of r.sections) {
    for (const v of s.votes) {
      // ⚠ REFUSE, do not silently absorb. A `partyNum` the ballot does not carry would
      // otherwise land in `ticketVotes` — and therefore in the DENOMINATOR of every
      // share — while being dropped from the ranking, which quietly lowers every real
      // candidate's percentage against a total nobody can see. The live route to this is
      // §2.5-9's suemg `99`, the „не подкрепям никого" marker, which is a protocol field
      // and must never arrive as a ticket.
      if (!onBallot.has(v.partyNum)) {
        throw new Error(
          `winnerRule: ${r.cycle} round ${r.round} section ${s.code} carries votes for ` +
            `ticket ${v.partyNum}, which is not on the ballot — it would be counted in ` +
            `the denominator and shown to nobody`,
        );
      }
      byTicket.set(v.partyNum, (byTicket.get(v.partyNum) ?? 0) + v.totalVotes);
    }
  }
  const ticketVotes = [...byTicket.values()].reduce((a, b) => a + b, 0);

  // ⚠ ABSENT vs ZERO. Before 2016 the form does not ask, so the field is undefined on
  // every section and `noneOfTheAbove` stays undefined — „the question was not put" is a
  // different fact from „nobody chose it", and only the second is a number.
  const asksNoneOfTheAbove = r.sections.some(
    (s) =>
      s.protocol.numValidNoOnePaperVotes !== undefined ||
      s.protocol.numValidNoOneMachineVotes !== undefined,
  );
  const noneOfTheAbove = asksNoneOfTheAbove
    ? sum(
        r,
        (s) =>
          (s.protocol.numValidNoOnePaperVotes ?? 0) +
          (s.protocol.numValidNoOneMachineVotes ?? 0),
      )
    : undefined;

  const validVotes = ticketVotes + (noneOfTheAbove ?? 0);
  if (validVotes <= 0) {
    throw new Error(
      `winnerRule: ${r.cycle} round ${r.round} has no valid votes, so no share is ` +
        `computable`,
    );
  }
  const protocolValidVotes =
    sum(
      r,
      (s) =>
        (s.protocol.numValidVotes ?? 0) +
        (s.protocol.numValidMachineVotes ?? 0),
    ) + (noneOfTheAbove ?? 0);

  const ranking: TicketStanding[] = r.tickets
    .map((t) => ({
      number: t.number,
      president: t.president,
      vicePresident: t.vicePresident,
      votes: byTicket.get(t.number) ?? 0,
      shareOfValid: (byTicket.get(t.number) ?? 0) / validVotes,
    }))
    // Votes descending; a tie keeps the lower ticket number so the order never depends
    // on the reader's iteration.
    .sort((a, b) => b.votes - a.votes || a.number - b.number);

  const registeredVoters = sum(r, (s) => s.protocol.numRegisteredVoters ?? 0);
  const signatures = sum(r, (s) => s.protocol.totalActualVoters);
  const turnout = registeredVoters > 0 ? signatures / registeredVoters : null;
  // ⚠ 2006's abroad protocols publish neither a registered count nor signatures, so
  // those 144 sections are in neither half of the ratio — the figure is unbiased but
  // DOMESTIC, and calling it national turnout would overstate what it covers.
  const abroadReportsNeither = r.sections.some(
    (s) =>
      s.abroad &&
      (s.protocol.numRegisteredVoters ?? 0) === 0 &&
      s.protocol.totalActualVoters === 0,
  );
  const turnoutBasis = abroadReportsNeither
    ? "подписи в списъците спрямо избирателите по списък — само в страната, " +
      "тъй като секциите в чужбина не отчитат нито едното, нито другото"
    : "подписи в списъците спрямо избирателите по списък (всички секции, " +
      "включително в чужбина)";

  // ⚠ STRICTLY more than half, both times — art. 93 (3) says „повече от половината".
  // `>=` would elect on an exact half, which the article does not.
  const meetsMajority = ranking[0].votes * 2 > validVotes;
  const meetsTurnout = turnout !== null && signatures * 2 > registeredVoters;

  return {
    cycle: r.cycle,
    round: r.round,
    date: r.date,
    ranking,
    ticketVotes,
    ...(noneOfTheAbove === undefined ? {} : { noneOfTheAbove }),
    validVotes,
    protocolValidVotes,
    validVotesResidue: validVotes - protocolValidVotes,
    registeredVoters,
    signatures,
    turnoutScope: abroadReportsNeither ? "domestic-only" : "all-sections",
    turnout,
    turnoutBasis,
    meetsMajority,
    meetsTurnout,
    // ⚠ AND, never OR. Every cycle in this corpus went to a runoff, and 2006 and 2011
    // each satisfy exactly one of the two — so an OR would have elected a president in
    // both, and an implementation checking only the majority would have elected one in
    // 2006.
    winsOutright: meetsMajority && meetsTurnout,
  };
};

/** A whole cycle's outcome. */
export interface CycleOutcome {
  cycle: string;
  round1: RoundTally;
  runoff?: RoundTally;
  decidedInRound: 1 | 2;
  /** The elected ticket, from the round that decided it. */
  winner: TicketStanding;
}

/**
 * Decide a cycle from its rounds.
 *
 * @param round1 - The first round's tally.
 * @param runoff - The runoff's tally, when the cycle had one.
 * @throws If round 1 was won outright and a runoff is supplied anyway, or if it was not
 *   and no runoff is — both are contradictions between the rule and the corpus, and
 *   resolving either silently would publish an outcome nothing supports.
 */
export const decideCycle = (
  round1: RoundTally,
  runoff?: RoundTally,
): CycleOutcome => {
  // ⚠ The two tallies are separate arguments, so nothing but this stops a caller pairing
  // one cycle's first round with another's runoff — which would publish a winner who
  // never stood in the election being described, with every figure internally consistent.
  if (round1.round !== 1) {
    throw new Error(
      `winnerRule: ${round1.cycle} was given round ${round1.round} as its first round`,
    );
  }
  if (runoff && runoff.round !== 2) {
    throw new Error(
      `winnerRule: ${runoff.cycle} was given round ${runoff.round} as its runoff`,
    );
  }
  if (runoff && runoff.cycle !== round1.cycle) {
    throw new Error(
      `winnerRule: round 1 is ${round1.cycle} and the runoff is ${runoff.cycle} — ` +
        `they are different elections`,
    );
  }
  if (round1.winsOutright && runoff) {
    throw new Error(
      `winnerRule: ${round1.cycle} round 1 elects ` +
        `${round1.ranking[0].president} outright (${(round1.ranking[0].shareOfValid * 100).toFixed(2)}% ` +
        `of valid votes, ${((round1.turnout ?? 0) * 100).toFixed(2)}% turnout), yet a ` +
        `runoff was held — the rule and the corpus disagree`,
    );
  }
  if (!round1.winsOutright && !runoff) {
    throw new Error(
      `winnerRule: ${round1.cycle} round 1 elects nobody ` +
        `(${(round1.ranking[0].shareOfValid * 100).toFixed(2)}% of valid votes, ` +
        `${((round1.turnout ?? 0) * 100).toFixed(2)}% turnout) and no runoff was supplied`,
    );
  }
  const decidedInRound = round1.winsOutright ? 1 : 2;
  const deciding = decidedInRound === 1 ? round1 : runoff!;
  return {
    cycle: round1.cycle,
    round1,
    ...(runoff ? { runoff } : {}),
    decidedInRound,
    // The runoff is a plurality — two tickets, no threshold.
    winner: deciding.ranking[0],
  };
};
