// The presidential cycle catalogue — what `src/data/json/presidential_elections.json`
// holds, and the runtime check that the committed file really has that shape.
//
// ⚠ IT IS A NAVIGATION FILE, NOT A RESULTS FILE. It ships in the entry bundle (a static
// `import` of the JSON), so it carries what a selector row, a hub tile and a route guard
// need — dates, the winner's names, how many tickets stood, and which features each round
// had — and nothing per-place. Every vote figure lives in `data/<cycle>/`, fetched.
//
// ⚠ THE `rounds` FLAGS EXIST SO A SURFACE NEVER OFFERS A SPLIT THAT DOES NOT EXIST. The
// parliamentary `ElectionInfo` carries the same idea as `hasSuemg` / `hasRecount`, and the
// consequence of getting it wrong is the same: a paper/machine toggle on a 2001 round
// renders two columns, one of them a fabricated zero, at a 200. Three of the five cycles
// predate machine voting entirely, and the SAME three predate „не подкрепям никого" — both
// flags flip at 2016, so a surface branching on one and then the other is branching on one
// era boundary twice.
//
// It is DERIVED — `npx tsx scripts/parsers_presidential/build_catalogue.ts --write` reads
// the committed raw corpus and rewrites it, and `build_catalogue.test.ts` fails when the
// two disagree. Do not hand-edit.
//
// Plan: docs/plans/presidential-elections-v1.md T4.1, decision 2.

/** What a round's protocols and ballots actually support. */
export interface PresidentialRoundCapabilities {
  /**
   * Votes were cast on machines somewhere in this round.
   *
   * ⚠ NOT „everywhere", and the round is part of the figure. Measured on ROUND 1 of each:
   * 2016 had machines in 500 of 12,340 sections carrying 1.15% of the vote; 2021 in 9,607
   * of 13,238 carrying 88.16%. (Round 2 is 1.61% and 89.22%, which is why a bare per-cycle
   * percentage has two true values.) A surface may offer the split when this is true; it
   * may not describe the round as machine-voted.
   */
  machineVoting: boolean;
  /**
   * ЦИК published the machines' flash-memory records for this round.
   *
   * ⚠ THE ONE FLAG THAT IS NOT VISIBLE IN THE PARSED NUMBERS — no presidential reader
   * ingests the flash tree — so it is derived from a path declared in `sources.ts` and
   * checked against the tree on disk. `machineVoting` without this is 2016: machines
   * counted votes, and their records were not published.
   */
  flashRecords: boolean;
  /**
   * The protocol carried „не подкрепям никого".
   *
   * ⚠ FALSE MEANS THE FORM DID NOT ASK, not that nobody chose it. It arrived with the
   * 2016 form; before that the option did not exist, so a zero would be a claim about
   * voters who were never offered it — and the constitutional majority's denominator
   * changes with it (decision 5).
   */
  noneOfTheAbove: boolean;
}

/** One presidential cycle, as the selector and the hub see it. */
export interface PresidentialElectionEntry {
  /** Folder id and URL segment — `2021_11_14_pvr`. ⚠ Never rendered as a label. */
  name: string;
  /** ISO date of round 1. */
  round1Date: string;
  /** ISO date of the runoff, or `null` when the cycle was decided in round 1. */
  round2Date: string | null;
  /**
   * Which round elected the president.
   *
   * ⚠ COMPUTED FROM THE VOTES (art. 93 (3)), never copied from a source field — and all
   * five cycles in this corpus went to a runoff, so a surface that assumes 1 is testable
   * only against a cycle that has not happened yet.
   */
  decidedInRound: 1 | 2;
  /** The elected pair, from the round that decided it. */
  winnerTicket: {
    /**
     * Ballot number.
     *
     * ⚠ A POSITION, NOT AN IDENTITY. It is stable across a cycle's two rounds — measured
     * on all five, the runoff keeps the round-1 numbers (Радев is 13 in both 2016 rounds,
     * 6 in both 2021 ones) — and means nothing across cycles, where 13 is Радев in 2016
     * and nobody in 2021. Linking one person between cycles goes through the person
     * resolver, never through this.
     */
    number: number;
    president: string;
    vicePresident: string;
  };
  /**
   * Ballot lines in ROUND 1.
   *
   * ⚠ Round 1's count and only round 1's. A runoff is the top two by law (art. 93 (4)) and
   * is 2 in every cycle here, so there is no second number worth storing — and storing one
   * would create a place for the two to disagree.
   */
  tickets: number;
  /** Keyed by round number. `2` is absent for a cycle decided in round 1. */
  rounds: Partial<Record<1 | 2, PresidentialRoundCapabilities>>;
}

/** ⚠ A shape, not a calendar: `2021-13-45` passes. It exists to refuse `"hello"`, which
 *  a bare `typeof === "string"` accepts and every date-rendering surface then prints. */
const isIsoDate = (v: unknown): boolean =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** A ballot position: a whole number from 1 up. `0` and `-1` are not positions. */
const isBallotNumber = (v: unknown): boolean =>
  typeof v === "number" && Number.isInteger(v) && v >= 1;

/**
 * The newest presidential cycle id, as a plain constant.
 *
 * ⚠ A LITERAL RATHER THAN `catalogue[0].name`, mirroring `LATEST_LOCAL_CYCLE`: the tile
 * registry names a cycle without a `[0]` lookup into a file it does not otherwise read, and
 * `presidentialCatalogue.test.ts` fails when the two disagree, so keeping it in step is not
 * a manual chore.
 *
 * ⚠ IT IS NOT A BUNDLE GUARD, and a first draft of this comment said it was.
 * `src/entryGraph.test.ts` covers only the two SECTOR registries — nothing polices
 * `electionsRegistry.ts` — and that registry already reaches all three catalogues through
 * `electionsHubCycle.ts` anyway. There is no byte cost either way: the registry is lazy and
 * those JSONs are in the entry chunk through `ElectionContext`.
 */
export const LATEST_PRESIDENTIAL_CYCLE = "2021_11_14_pvr";

const isCapabilities = (v: unknown): v is PresidentialRoundCapabilities => {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.machineVoting === "boolean" &&
    typeof c.flashRecords === "boolean" &&
    typeof c.noneOfTheAbove === "boolean"
  );
};

/**
 * Is this value a catalogue entry?
 *
 * ⚠ THIS EXISTS BECAUSE THE IMPORT IS A CAST. TypeScript types a JSON import structurally
 * — `decidedInRound` arrives as `number`, `rounds` as an index signature — so every
 * consumer reaches the catalogue through `as PresidentialElectionEntry[]`, which asserts a
 * shape rather than checking one. A hand-edit that drops `flashRecords` or writes
 * `decidedInRound: 3` compiles, ships, and renders as `undefined` on a live page. The
 * committed file is checked against this at test time.
 *
 * @param v - A parsed catalogue row.
 * @returns Whether every field is present and in range.
 */
export const isPresidentialElectionEntry = (
  v: unknown,
): v is PresidentialElectionEntry => {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  if (typeof e.name !== "string" || !e.name.endsWith("_pvr")) return false;
  if (!isIsoDate(e.round1Date)) return false;
  if (e.round2Date !== null && !isIsoDate(e.round2Date)) return false;
  if (e.decidedInRound !== 1 && e.decidedInRound !== 2) return false;
  // ⚠ INTEGER, and at least two: art. 93 (4) sends the top TWO to a runoff, so a cycle
  // cannot have had fewer ballot lines than that. A bare `>= 2` admits `2.5`.
  if (!Number.isInteger(e.tickets) || (e.tickets as number) < 2) return false;
  const w = e.winnerTicket as Record<string, unknown> | undefined;
  if (
    typeof w !== "object" ||
    w === null ||
    !isBallotNumber(w.number) ||
    typeof w.president !== "string" ||
    !w.president ||
    typeof w.vicePresident !== "string" ||
    !w.vicePresident
  ) {
    return false;
  }
  const rounds = e.rounds as Record<string, unknown> | undefined;
  if (typeof rounds !== "object" || rounds === null) return false;
  // Exactly the rounds the cycle held: round 1 always, round 2 iff there was a runoff.
  // ⚠ Both directions matter. A missing `2` on a cycle with a `round2Date` leaves a
  // runoff surface with no capabilities to read; a present `2` on one without invites a
  // runoff tab for a round nobody voted in.
  const keys = Object.keys(rounds).sort();
  const expected = e.round2Date === null ? ["1"] : ["1", "2"];
  if (keys.join(",") !== expected.join(",")) return false;
  // ⚠ A BICONDITIONAL, not one arm of one. Art. 93 (4): a runoff is held iff round 1
  // elected nobody, so „there was a runoff" and „round 2 decided it" are the same fact.
  // Checking one way admits `{ round2Date: "…", decidedInRound: 1 }` — the shape a
  // hand-edit of a single field produces, on the field every consumer branches on to pick
  // which round to render as the result.
  if ((e.round2Date === null) !== (e.decidedInRound === 1)) return false;
  return keys.every((k) => isCapabilities(rounds[k]));
};
