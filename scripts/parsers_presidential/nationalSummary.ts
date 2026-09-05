// `national_summary.json` — a cycle's outcome, per round, with every basis named.
//
// The roll-ups in `aggregate.ts` carry VOTES and nothing else, deliberately: turnout,
// invalid ballots and „не подкрепям никого" are protocol figures and belong to a round
// rather than to any one oblast. This is where they live.
//
// ⚠⚠ EVERY FIGURE THAT COULD BE COMPUTED TWO WAYS NAMES WHICH ONE IT IS. That is not
// decoration on this file — it is the file's job. Three pairs in particular:
//
//   • the majority DENOMINATOR — valid votes („никого" included), never the ticket sum;
//     in 2021 the two disagree across the constitutional threshold (§2.4, decision 5);
//   • the TURNOUT basis — signatures over registered voters, which is not the figure
//     ЦИК's activity page prints, and which in 2006 excludes the country's abroad
//     sections entirely (§2.5-11);
//   • the ABROAD basis — votes cast, never a registered-voter denominator (decision 6).
//
// ⚠ AND THE R1→R2 SWING IS PER SURVIVING TICKET, computed only for the two that stood in
// both rounds. A „swing" for a ticket that was not on the runoff ballot is not a fall to
// zero; it is a candidate who was not standing, and rendering it as a loss would invent
// a collapse that never happened — 2021 had 23 tickets in round 1 and 2 in the runoff, so
// 21 would each show a delta equal to minus their whole round-1 vote, Карадайъ's 309,681
// among them.
//
// Plan: docs/plans/presidential-elections-v1.md T3.2.

import type { AggregatedRound } from "./aggregate";
import { decideCycle, tallyRound, type RoundTally } from "./winnerRule";
import { ABROAD_PREFIX_BY_ERA } from "./places";
import type { PresidentialRound, Ticket } from "./types";

/** ЦИК's own activity-page figures, where the page is archived. */
export interface CikActivity {
  registeredVoters: number;
  cast: number;
}

/**
 * The activity page's own numbers, per cycle and round.
 *
 * ⚠ CARRIED BESIDE OURS, NEVER INSTEAD OF THEM, and never reconciled. Summing the 2021
 * round-1 protocols gives signatures of 2,687,307 — exactly the page's figure — while the
 * registered count comes out at 6,667,895 over all forms against the page's 6,635,305.
 * Neither of our two registered bases reproduces its 40.50%. The page counts registration
 * differently; chasing its figure would mean inventing a third basis, and dropping it
 * would hide that the two disagree. §2.5-11.
 */
export const CIK_ACTIVITY: Record<
  string,
  Partial<Record<1 | 2, CikActivity>>
> = {
  "2021_11_14_pvr": {
    1: { registeredVoters: 6_635_305, cast: 2_687_307 },
  },
};

/** One ticket's standing, as the summary publishes it. */
export interface SummaryTicket {
  number: number;
  president: string;
  vicePresident: string;
  nominatedBy: Ticket["nominatedBy"];
  votes: number;
  /** Of the VALID votes — see the banner. */
  shareOfValid: number;
}

export interface RoundSummary {
  round: 1 | 2;
  date: string;
  /** Best first; ties keep the lower ticket number. */
  ranking: SummaryTicket[];
  votes: {
    /** Σ the ticket rows. ⚠ NOT the denominator of a share. */
    tickets: number;
    /** „не подкрепям никого". ⚠ ABSENT before 2016 — the form did not ask. */
    noneOfTheAbove?: number;
    /** `tickets + noneOfTheAbove`. The denominator of every share here. */
    valid: number;
    /** The protocols' own valid total — a second basis, never the denominator. */
    validFromProtocols: number;
    /** `valid − validFromProtocols`. ЦИК's own per-section inconsistency. */
    validResidue: number;
    /**
     * Ballots the protocols recorded as invalid.
     *
     * ⚠ PAPER ONLY, IN EVERY ERA, and that is a fact about voting rather than a gap: a
     * machine does not accept an invalid ballot. It matters because it makes the figure
     * incomparable across eras without its denominator — 2021's 9,487 is 0.35% of the
     * valid votes and 3.0% of the PAPER ones, and only the second is a rate anybody
     * means. `invalidBasis` says so; never render this over `valid`.
     */
    invalid: number;
    invalidBasis: "paper-ballots-found-invalid";
  };
  turnout: {
    registeredVoters: number;
    /** Signatures in the rolls. */
    cast: number;
    /** `cast / registeredVoters`, or null when the corpus cannot support one. */
    pct: number | null;
    /** What that ratio is OF, in words, for a surface to print beside it. */
    basis: string;
    registeredBasis: "protocol-all-forms";
    castBasis: "signatures";
    /** ЦИК's own figures where archived — see `CIK_ACTIVITY`. */
    cikActivity?: CikActivity;
  };
  /** Art. 93 (3), both conditions. */
  outcome: {
    meetsMajority: boolean;
    meetsTurnout: boolean;
    winsOutright: boolean;
  };
  abroad: {
    sections: number;
    /**
     * Σ the ticket rows of every abroad section — the same basis as `votes.tickets`, so
     * the two are comparable.
     *
     * ⚠ NOT „ballots cast", which is `ballotsFound` and is LARGER: measured on 2016 round
     * 1, 104,457 ticket votes against 114,776 ballots found, a 9.0% gap made of invalid
     * ballots and „никого". The field was called `votes` and documented as votes cast,
     * which is the one reading it does not support.
     */
    ticketVotes: number;
    /**
     * Ballots found in the boxes and on the machines, abroad.
     *
     * ⚠ THIS IS THE TURNOUT NUMERATOR ABROAD, and it is the only one there can be —
     * decision 6, and §2.5-3 for 2006, whose abroad protocols report neither a roll nor
     * signatures while casting real ballots. There is no registered-voter denominator
     * outside the country, so this is a COUNT and never a percentage.
     */
    ballotsFound: number;
    /** Countries with at least one section. */
    countries: number;
    /** Sections whose country the corpus cannot name. Their votes are in `ticketVotes`. */
    sectionsWithoutCountry: number;
    /**
     * Sections whose protocol reports no signature count at all.
     *
     * ⚠ 2006's 144 abroad sections publish точка 3 = 0 while casting 46,113 valid votes,
     * so they are in neither half of the national turnout ratio — which is why that
     * ratio's `basis` says „само в страната". Carried here so a surface can say how many
     * sections it is describing rather than inferring it from a zero.
     */
    sectionsWithoutSignatures: number;
  };
  /**
   * Sections placement refused, and the ticket votes in them.
   *
   * ⚠ THESE ARE ALREADY INSIDE `votes.tickets`, as are the abroad ones — the round-level
   * figures cover every section, and only the PER-PLACE roll-ups exclude anything.
   * Adding this to `votes.tickets` double-counts; what it is for is saying how much of
   * the round `region_votes.json` does not describe.
   */
  unplaced: { sections: number; votes: number; basis: "ticket-votes" };
}

/** How a ticket moved between the two rounds. */
export interface Swing {
  number: number;
  president: string;
  round1Votes: number;
  round2Votes: number;
  deltaVotes: number;
  round1Share: number;
  round2Share: number;
  deltaShare: number;
}

export interface NationalSummary {
  cycle: string;
  round1Date: string;
  round2Date: string | null;
  decidedInRound: 1 | 2;
  winner: { number: number; president: string; vicePresident: string };
  rounds: RoundSummary[];
  /**
   * Per-ticket movement between the rounds, and the change in turnout.
   *
   * ⚠ ONLY THE SURVIVING TICKETS, and `null` when there was no runoff. See the banner:
   * a ticket absent from the runoff did not fall to zero, it was not standing.
   */
  swing: {
    tickets: Swing[];
    /**
     * Round 2's turnout minus round 1's.
     *
     * ⚠ A DIFFERENCE OF TWO RATIOS, so it is only meaningful where both rounds use the
     * same basis — see `RoundSummary.turnout.basis`. In 2006 both are domestic-only, so
     * the delta is a domestic figure too; a consumer must carry the basis with it rather
     * than presenting a bare percentage-point change.
     */
    turnoutDeltaPct: number | null;
    /** Whether the two rounds' turnout figures rest on the same basis. */
    turnoutBasesMatch: boolean;
  } | null;
}

const summariseRound = (
  tally: RoundTally,
  agg: AggregatedRound,
  round: PresidentialRound,
): RoundSummary => {
  const abroadCountries = agg.abroad.entries.filter((e) => e.key !== "");
  // ⚠ Taken from the PLACEMENT rather than from `section.abroad`, which the 2016 and 2021
  // readers never set — reading that flag here would return a confident zero for the two
  // cycles with the most abroad sections.
  const abroadPrefix = ABROAD_PREFIX_BY_ERA[round.sourceEra];
  const abroadSections = round.sections.filter((s) =>
    s.code.startsWith(abroadPrefix),
  );
  const byNumber = new Map(round.tickets.map((t) => [t.number, t]));

  return {
    round: tally.round,
    date: tally.date,
    ranking: tally.ranking.map((r) => ({
      number: r.number,
      president: r.president,
      vicePresident: r.vicePresident,
      nominatedBy: byNumber.get(r.number)!.nominatedBy,
      votes: r.votes,
      shareOfValid: r.shareOfValid,
    })),
    votes: {
      tickets: tally.ticketVotes,
      // ⚠ Spread, so the key is ABSENT before 2016 rather than 0 — the form did not ask,
      // and a stored zero would claim nobody chose an option nobody was offered.
      ...(tally.noneOfTheAbove === undefined
        ? {}
        : { noneOfTheAbove: tally.noneOfTheAbove }),
      valid: tally.validVotes,
      validFromProtocols: tally.protocolValidVotes,
      validResidue: tally.validVotesResidue,
      invalid: round.sections.reduce(
        (a, s) => a + (s.protocol.numInvalidBallotsFound ?? 0),
        0,
      ),
      invalidBasis: "paper-ballots-found-invalid",
    },
    turnout: {
      registeredVoters: tally.registeredVoters,
      cast: tally.signatures,
      pct: tally.turnout,
      basis: tally.turnoutBasis,
      registeredBasis: "protocol-all-forms",
      castBasis: "signatures",
      // ⚠ A COPY. Handing out the module constant lets any consumer mutate the table
      // every later summary reads.
      ...(CIK_ACTIVITY[tally.cycle]?.[tally.round]
        ? { cikActivity: { ...CIK_ACTIVITY[tally.cycle][tally.round]! } }
        : {}),
    },
    outcome: {
      meetsMajority: tally.meetsMajority,
      meetsTurnout: tally.meetsTurnout,
      winsOutright: tally.winsOutright,
    },
    abroad: {
      sections: agg.placement.abroadSections,
      ticketVotes: agg.abroad.coverage.votes,
      ballotsFound: abroadSections.reduce(
        (a, s) =>
          a +
          (s.protocol.numPaperBallotsFound ?? 0) +
          (s.protocol.numMachineBallots ?? 0),
        0,
      ),
      countries: abroadCountries.length,
      sectionsWithoutCountry: agg.placement.abroadUnresolved.length,
      sectionsWithoutSignatures: abroadSections.filter(
        (s) => s.signaturesUnreported,
      ).length,
    },
    unplaced: {
      sections: agg.placement.unplaced.length,
      votes: agg.placement.unplaced.reduce((a, u) => a + u.votes, 0),
      basis: "ticket-votes",
    },
  };
};

/**
 * Build a cycle's summary from its rounds.
 *
 * @param rounds - Round 1, and the runoff when there was one, in order.
 * @param aggs - The matching aggregations, same order.
 * @returns The summary. ⚠ `swing` is null for a cycle decided in round 1.
 * @throws Via `decideCycle` when the computed rule and the corpus disagree about whether
 *   a runoff happened — that is a contradiction, not something to reconcile silently.
 */
export const buildNationalSummary = (
  rounds: PresidentialRound[],
  aggs: AggregatedRound[],
): NationalSummary => {
  if (!rounds.length || rounds.length > 2 || rounds.length !== aggs.length) {
    throw new Error(
      `nationalSummary: ${rounds.length} round(s) against ${aggs.length} ` +
        `aggregation(s) — a cycle has one round or two`,
    );
  }
  // ⚠⚠ THE TWO ARRAYS ARE PAIRED BY POSITION, AND NOTHING ELSE WOULD NOTICE A MISPAIR.
  // Reproduced: handing 2016's aggregations with 2021's rounds published 325 abroad
  // sections under `cycle: "2021_11_14_pvr"`, with every vote figure correct, because the
  // roll-ups and the tallies are read from different arguments. `AggregatedRound` carries
  // its own cycle, round and date; checking them costs nothing and is the only thing
  // between a caller's ordering slip and a published summary about the wrong election.
  rounds.forEach((r, i) => {
    const a = aggs[i];
    if (a.cycle !== r.cycle || a.round !== r.round || a.date !== r.date) {
      throw new Error(
        `nationalSummary: round ${r.cycle}/${r.round} was paired with an aggregation ` +
          `of ${a.cycle}/${a.round} — they are different rounds`,
      );
    }
    if (i > 0 && r.cycle !== rounds[0].cycle) {
      throw new Error(
        `nationalSummary: rounds from ${rounds[0].cycle} and ${r.cycle} in one summary`,
      );
    }
  });
  const tallies = rounds.map((r) => tallyRound(r));
  const outcome = decideCycle(tallies[0], tallies[1]);
  const summaries = rounds.map((r, i) =>
    summariseRound(tallies[i], aggs[i], r),
  );

  // ⚠ ONLY THE TICKETS THAT STOOD IN BOTH, joined on ticket number AND checked by name.
  // A ticket absent from the runoff did not lose its votes; it was not on the ballot, and
  // a delta of −309,681 against Карадайъ's round-1 total would describe a collapse that
  // never happened.
  //
  // ⚠ THE NAME CHECK IS NOT REDUNDANT. 2006's runoff RE-USES the round-1 numbers and
  // 2001's RENUMBERS its two survivors 1 and 2, so „ticket 2" is a different person in
  // the two rounds of at least one era in this corpus. Joining on the number alone would
  // print round 1's name over round 2's votes, silently.
  const swing =
    tallies.length < 2
      ? null
      : {
          tickets: tallies[0].ranking
            .filter((r) =>
              tallies[1].ranking.some((x) => x.number === r.number),
            )
            .map((r) => {
              const later = tallies[1].ranking.find(
                (x) => x.number === r.number,
              )!;
              if (later.president !== r.president) {
                throw new Error(
                  `nationalSummary: ${rounds[0].cycle} ticket ${r.number} is ` +
                    `"${r.president}" in round 1 and "${later.president}" in the ` +
                    `runoff — the ballot was renumbered, so a swing joined on the ` +
                    `number alone would print one candidate's name over another's votes`,
                );
              }
              return {
                number: r.number,
                president: r.president,
                round1Votes: r.votes,
                round2Votes: later.votes,
                deltaVotes: later.votes - r.votes,
                round1Share: r.shareOfValid,
                round2Share: later.shareOfValid,
                deltaShare: later.shareOfValid - r.shareOfValid,
              };
            }),
          turnoutDeltaPct:
            tallies[0].turnout === null || tallies[1].turnout === null
              ? null
              : tallies[1].turnout - tallies[0].turnout,
          turnoutBasesMatch:
            tallies[0].turnoutBasis === tallies[1].turnoutBasis,
        };

  return {
    cycle: rounds[0].cycle,
    round1Date: rounds[0].date,
    round2Date: rounds[1]?.date ?? null,
    decidedInRound: outcome.decidedInRound,
    winner: {
      number: outcome.winner.number,
      president: outcome.winner.president,
      vicePresident: outcome.winner.vicePresident,
    },
    rounds: summaries,
    swing,
  };
};
