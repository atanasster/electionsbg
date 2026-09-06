// `national_summary.json` as the BROWSER reads it — the published shape, not the parser's.
//
// ⚠ THIS IS A SECOND DECLARATION ON PURPOSE, and `source_links.ts` states the reason for the
// local tree: a reader that bound itself to `Parameters<typeof buildNationalSummary>` would be
// coupled to whatever shape the producer happens to have, and the producer's module opens with
// `node:fs`-adjacent imports (`./types`, `./places`) that no browser chunk may pull in. What
// stops the two drifting is not discipline: `national_summary_shape.test.ts` asserts the
// producer's `NationalSummary` is assignable to this type, so a producer change that this file
// cannot describe fails there rather than at a reader.
//
// ⚠ ONLY WHAT A SURFACE RENDERS. The producer carries `validResidue`, `cikActivity`,
// `unplaced` and the per-round `registeredBasis`/`castBasis` markers; a page that does not show
// them does not declare them, because a declared-and-unused field is a claim nobody checks.
// Widen it when a surface needs one, and the assignability gate keeps that honest.

/** One ticket's standing in one round. ⚠ A PERSON, NOT A PARTY — the nominator may be a party,
 *  a coalition or an инициативен комитет, which is why `nominatedBy` carries its own kind. */
export interface PresidentialSummaryTicket {
  /** Ballot position. ⚠ Stable across a cycle's two rounds and meaningless across cycles. */
  number: number;
  president: string;
  vicePresident: string;
  nominatedBy: { name: string; kind: string };
  votes: number;
  /** Of the VALID votes (tickets + „не подкрепям никого"), as a fraction of 1. */
  shareOfValid: number;
}

export interface PresidentialSummaryRound {
  round: 1 | 2;
  date: string;
  /** Best first. */
  ranking: PresidentialSummaryTicket[];
  votes: {
    tickets: number;
    /** ⚠ ABSENT before 2016 — the form did not ask, and a rendered 0 would claim nobody chose
     *  an option nobody was offered. Never coalesce it. */
    noneOfTheAbove?: number;
    /** The denominator of every share here. */
    valid: number;
    /** ⚠ PAPER ONLY, IN EVERY ERA — a machine does not accept an invalid ballot. Rendering it
     *  over `valid` understates the rate by the machine share; `invalidBasis` says so. */
    invalid: number;
    invalidBasis: "paper-ballots-found-invalid";
  };
  turnout: {
    registeredVoters: number;
    /** Signatures in the rolls. */
    cast: number;
    /** ⚠ `null` MEANS THE CORPUS CANNOT SUPPORT A RATE, never 0%. */
    pct: number | null;
    /** ⚠ A BULGARIAN SENTENCE FROM THE PRODUCER. It says WHICH sections the ratio is over —
     *  2006's excludes every abroad section — and it is corpus prose, so it is rendered as
     *  provenance beside the figure rather than as UI copy. */
    basis: string;
  };
  /** Art. 93 (3), both conditions, decided by the producer. */
  outcome: {
    meetsMajority: boolean;
    meetsTurnout: boolean;
    winsOutright: boolean;
  };
  abroad: {
    sections: number;
    /** Σ the abroad ticket rows. ⚠ NOT ballots cast, which is larger. */
    ticketVotes: number;
    /** ⚠ THE ONLY TURNOUT NUMERATOR THERE CAN BE ABROAD — a COUNT, never a percentage.
     *  There is no registered-voter denominator outside the country (decision 6). */
    ballotsFound: number;
    countries: number;
    sectionsWithoutCountry: number;
    sectionsWithoutSignatures: number;
  };
}

/** How a ticket moved between the rounds. ⚠ ONLY the two that stood in both. */
export interface PresidentialSummarySwing {
  number: number;
  president: string;
  round1Votes: number;
  round2Votes: number;
  deltaVotes: number;
  round1Share: number;
  round2Share: number;
  deltaShare: number;
}

export interface PresidentialSummary {
  cycle: string;
  round1Date: string;
  round2Date: string | null;
  decidedInRound: 1 | 2;
  winner: { number: number; president: string; vicePresident: string };
  rounds: PresidentialSummaryRound[];
  /** ⚠ `null` when there was no runoff — and a ticket absent from the runoff did not fall to
   *  zero, it was not standing, which is why this covers the survivors only. */
  swing: {
    tickets: PresidentialSummarySwing[];
    /** ⚠ A DIFFERENCE OF TWO RATIOS — meaningless unless `turnoutBasesMatch`. */
    turnoutDeltaPct: number | null;
    turnoutBasesMatch: boolean;
  } | null;
}

/** ⚠ EVERY LEAF THE SCREEN DEREFERENCES. A first cut validated the CONTAINERS — „ranking is an
 *  array", „votes has a valid" — which the renderer then read past: a ranking row with no
 *  `votes` passed the guard and threw `Cannot read properties of undefined` inside the render,
 *  bypassing the `unusable` state that exists precisely so a bad body degrades to a sentence.
 *  With no error boundary anywhere in `src/` that unmounts the React root. */
const isTicket = (v: unknown): v is PresidentialSummaryTicket => {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.number === "number" &&
    typeof r.president === "string" &&
    typeof r.vicePresident === "string" &&
    typeof r.votes === "number" &&
    typeof r.shareOfValid === "number" &&
    typeof (r.nominatedBy as Record<string, unknown> | undefined)?.name ===
      "string"
  );
};

const isRound = (v: unknown): v is PresidentialSummaryRound => {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  if (r.round !== 1 && r.round !== 2) return false;
  if (typeof r.date !== "string") return false;
  if (!Array.isArray(r.ranking) || !r.ranking.every(isTicket)) return false;
  const votes = r.votes as Record<string, unknown> | undefined;
  if (
    !votes ||
    typeof votes.valid !== "number" ||
    typeof votes.invalid !== "number"
  )
    return false;
  const turnout = r.turnout as Record<string, unknown> | undefined;
  if (!turnout) return false;
  // ⚠ `null` IS A VALID `pct` AND THE GUARD MUST SAY SO. Rejecting it would send a round whose
  // protocols carry no roll at all down the "malformed" path, which is the one shape that must
  // stay distinguishable from "this figure does not exist". The RANGE is checked for the
  // opposite reason — see the field's docblock: a fraction here, 0..100 in the catalogue.
  if (
    turnout.pct !== null &&
    (typeof turnout.pct !== "number" || turnout.pct < 0 || turnout.pct > 1)
  )
    return false;
  const outcome = r.outcome as Record<string, unknown> | undefined;
  if (
    !outcome ||
    typeof outcome.winsOutright !== "boolean" ||
    typeof outcome.meetsMajority !== "boolean" ||
    typeof outcome.meetsTurnout !== "boolean"
  )
    return false;
  const abroad = r.abroad as Record<string, unknown> | undefined;
  return (
    !!abroad &&
    typeof abroad.sections === "number" &&
    typeof abroad.ballotsFound === "number" &&
    typeof abroad.countries === "number"
  );
};

/** Enough of the shape to know a reader can render it. ⚠ Not a schema check: it exists so a
 *  404 body, an HTML error page or a truncated file is refused rather than rendered as an
 *  election with no candidates. */
export const isPresidentialSummary = (v: unknown): v is PresidentialSummary => {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  if (typeof s.cycle !== "string" || !s.cycle) return false;
  if (s.decidedInRound !== 1 && s.decidedInRound !== 2) return false;
  if (!Array.isArray(s.rounds) || s.rounds.length === 0) return false;
  if (!s.rounds.every(isRound)) return false;
  const w = s.winner as Record<string, unknown> | undefined;
  return typeof w?.president === "string" && typeof w?.number === "number";
};
