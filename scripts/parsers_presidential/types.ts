// The one shape every era reader produces, so the aggregator never learns which of
// the five publication formats a round came from.
//
// ⚠ IT REUSES `Votes` AND `SectionProtocol` FROM THE PARLIAMENTARY TYPES, DELIBERATELY.
// A presidential ballot is a different ELECTION, not a different kind of number: a
// section still has registered voters, signatures, ballots found, invalid votes and a
// per-option tally. Reusing the two carries the region / municipality / settlement
// aggregation, `addResults`, and the existing map and result-list rendering for free —
// and it is what lets the output tree be the parliamentary tree per round rather than
// a parallel type family that every consumer would have to learn.
//
// The one substitution: `Votes.partyNum` is the TICKET NUMBER. A ticket is a
// president+vice-president pair on a numbered ballot line, so the ballot number plays
// exactly the role a party number does — it is the key the votes file uses, it is
// stable across the two rounds, and nothing about it is a party.

import type { SectionProtocol, Votes } from "@/data/dataTypes";
import type { PresidentialEra } from "./sources";

/**
 * A president + vice-president pair on the ballot.
 *
 * ⚠ `number` IS THE KEY and it is a ballot position, not an identity: ticket 13 is
 * Радев in 2016 and nobody in 2021 (he is 6 there). Anything cross-cycle keys on
 * `canonicalKey` instead.
 */
export type Ticket = {
  /** Ballot number — the key `votes` rows carry, stable across both rounds. */
  number: number;
  president: string;
  vicePresident: string;
  nominatedBy: {
    name: string;
    /** A party, a coalition of parties, or an инициативен комитет — three legally
     *  distinct things. ⚠ `"unknown"` where the label does not say and no override
     *  covers it: the 2016/2021 files carry no coalition marker at all, so defaulting
     *  to "party" published four real coalitions as parties. */
    kind: NominatorKind;
  };
  /** Short label, where a known party lends one. */
  nickName?: string;
  color?: string;
  /** Folded president name, for linking one person's tickets ACROSS cycles (Радев
   *  2016 → 2021, Сидеров 2006 → 2011 → 2021). ⚠ A DISPLAY key only — the real
   *  person link goes through the person resolver, which refuses a shared name. */
  canonicalKey: string;
};

/** One polling section's result in one round. */
export type PresidentialSection = {
  /** The section code as published. ⚠ Its GRID differs per era — 2011 is on the
   *  28-oblast ОИК grid and does not join parliamentary sections. */
  code: string;
  round: 1 | 2;
  ekatte?: string;
  /** Oblast key (`BLG`), resolved by the aggregator, not the reader. */
  oblast?: string;
  obshtina?: string;
  placeName: string;
  /** Set for a section outside the country. `country` is null when the source names
   *  only a city and no crosswalk resolves it — never guessed. */
  abroad?: { country: string | null; city: string };
  isMobile: boolean;
  isShip: boolean;
  /** Voting machines in the section; 0 before machine voting existed. */
  machines: number;
  /**
   * ⚠ `protocol.totalActualVoters` IS A LITERAL ZERO THAT MEANS „NOT ANSWERED".
   *
   * The shared `SectionProtocol` makes that field REQUIRED — it is the parliamentary
   * shape, used site-wide — so a reader cannot leave it absent the way it leaves
   * „никого" absent before 2016. This flag carries the distinction instead: `true` means
   * the era's protocols do not report a signature count for this section, so the 0 is
   * not a turnout figure.
   *
   * ⚠ `undefined` means „this reader does not distinguish", NOT „reported". Only
   * `era2006` sets it today, so every 2011/2016/2021 section reads as falsy by omission
   * rather than by statement. A new era whose protocols omit signatures must set it, and
   * T3.2's turnout basis must read it rather than inferring from the zero.
   *
   * The live case is 2006 abroad. All 144 prefix-32 sections carry точка 3 = 0 while
   * holding 46,113 valid votes in round 1, and NOT ONE domestic section does. Read as a
   * count, that publishes 0% turnout abroad against real ballots — and, worse, it is
   * the shape no aggregate notices, since the zeros vanish into a national sum that
   * still reconciles. A turnout surface must fall back to ballots found (точка 6) here
   * and SAY that it did. Plan §2.5-3.
   */
  signaturesUnreported?: boolean;
  protocol: SectionProtocol;
  /** `partyNum` is the TICKET number. */
  votes: Votes[];
};

/** One round of one cycle, as read from its raw tree. */
export type PresidentialRound = {
  /** Cycle folder id, e.g. `2021_11_14_pvr`. */
  cycle: string;
  round: 1 | 2;
  /** ISO date of this round's vote. */
  date: string;
  tickets: Ticket[];
  sections: PresidentialSection[];
  sourceEra: PresidentialEra;
};

/** Empty protocol, so a reader fills only the fields its era actually publishes and
 *  never writes a `0` standing in for "this form does not ask". */
export const emptyProtocol = (): SectionProtocol =>
  ({ totalActualVoters: 0 }) as SectionProtocol;

/**
 * Fold a ticket's votes into a section's tally, summing when the ticket is already
 * there.
 *
 * ⚠ SUMMING IS THE POINT. In 2021 a section's paper protocol and EACH of its voting
 * machines are separate rows carrying the same ticket numbers, so a reader that
 * assigned rather than added would keep only the last machine and drop the rest — the
 * §2.5-1 trap. Every era goes through this for the same reason.
 */
export const addTicketVotes = (
  into: Votes[],
  ticket: number,
  counts: { paper?: number; machine?: number },
): void => {
  const paper = counts.paper ?? 0;
  const machine = counts.machine ?? 0;
  const existing = into.find((v) => v.partyNum === ticket);
  if (existing) {
    existing.paperVotes = (existing.paperVotes ?? 0) + paper;
    existing.machineVotes = (existing.machineVotes ?? 0) + machine;
    existing.totalVotes =
      (existing.paperVotes ?? 0) + (existing.machineVotes ?? 0);
    return;
  }
  into.push({
    partyNum: ticket,
    paperVotes: paper,
    machineVotes: machine,
    totalVotes: paper + machine,
  });
};

/** Fold a president's name for cross-cycle display linking: case, spacing and the
 *  hyphen/space distinction removed, middle name kept. Deliberately NOT a person
 *  identity — see `Ticket.canonicalKey`. */
export const canonicalTicketKey = (president: string): string =>
  president
    .toLocaleLowerCase("bg")
    .replace(/[-\s]+/g, " ")
    .trim();

/**
 * Split a ballot's „President и VicePresident" string into its two names.
 *
 * ⚠ THE SEPARATOR IS A WORD, SO IT NEEDS BOUNDARIES. A bare `и` matches inside
 * „Илияна", „Христов" and most Bulgarian names; the split is on a standalone „и"
 * surrounded by spaces. A hyphenated compound surname („Митева-Матеева",
 * „Касимова-Моасе") is ONE token and must not be split on.
 *
 * @param combined - e.g. „Румен Георгиев Радев и Илияна Малинова Йотова".
 * @returns The two names, or `null` when the string carries no separator — the caller
 *   decides whether that is an error, since not every era publishes a pair here.
 */
export const splitTicketNames = (
  combined: string,
): { president: string; vicePresident: string } | null => {
  const parts = combined.split(/\s+и\s+/);
  if (parts.length !== 2) return null;
  const [president, vicePresident] = parts.map((p) => p.trim());
  if (!president || !vicePresident) return null;
  return { president, vicePresident };
};

/** What kind of body put a ticket on the ballot. `"unknown"` is a real answer, not a
 *  placeholder — see `nominatorKind`. */
export type NominatorKind = "party" | "coalition" | "committee" | "unknown";

/** Nominator labels whose kind the label does not state but which are known, in the
 *  repo's `manualCanonicals` / `partyOverrides` style.
 *
 *  ⚠ Every entry is a COALITION trading under a plain name — the one case no marker
 *  catches, and the one where guessing produces a wrong claim about a real political
 *  formation. Three of the four enumerate their own members in the label. Parties are
 *  deliberately NOT listed: a party with no marker stays `unknown`, because adding
 *  them one by one would turn this table into an unverifiable roster and the wrong
 *  answer would look identical to the right one. */
export const NOMINATOR_KIND_OVERRIDES: Record<string, NominatorKind> = {
  // 2016 — a bloc of five parties (СДС, ДСБ, ДБГ, БЗНС, НПСД)
  "РЕФОРМАТОРСКИ БЛОК": "coalition",
  // 2016 — the label names both members, and `ПП …` would otherwise read as a party
  "ПП Движение 21 – ПП НДСВ": "coalition",
  // 2016 — the label names all three
  "ОБЕДИНЕНИ ПАТРИОТИ – НФСБ, АТАКА и ВМРО": "coalition",
  // 2021 — the label names all three
  "ПАТРИОТИЧЕН ФРОНТ – НФСБ, БДС РАДИКАЛИ И БНДС ЦЕЛОКУПНА БЪЛГАРИЯ":
    "coalition",
};

/**
 * Classify the body that nominated a ticket.
 *
 * ⚠ IT RETURNS `"unknown"` RATHER THAN GUESSING, and that is the whole design. An
 * earlier version defaulted to `"party"` on the premise that the register names the
 * kind — which it does only SOMETIMES. Measured over every distinct nominator label in
 * the 2016 and 2021 files: 44 labels, of which 24 carry no coalition or committee
 * marker at all. Seven of those declare themselves parties with a `ПП` prefix
 * („Политическа партия"), which IS the register stating it; the rest — АТАКА, ВОЛЯ,
 * ВЪЗРАЖДАНЕ, ДПС, ВМРО, РЕФОРМАТОРСКИ БЛОК, ОБЕДИНЕНИ ПАТРИОТИ … — say nothing about
 * their legal form. Defaulting published four real coalitions as PARTIES, three of
 * them while naming their own member parties in the label.
 *
 * A party, a coalition and an инициативен комитет are legally distinct, so "not marked
 * a committee and not marked a coalition" is not evidence of a party. Where the label
 * does not say and no override covers it, the answer is that we do not know, and a
 * surface must render it that way rather than assert a legal form.
 *
 * @param name - The nominator label exactly as ЦИК publishes it.
 * @returns The kind, or `"unknown"`.
 */
export const nominatorKind = (name: string): NominatorKind => {
  const trimmed = name.trim();
  const n = trimmed.toLocaleLowerCase("bg");
  if (n.includes("инициативен комитет") || n.startsWith("ик за")) {
    return "committee";
  }
  if (n.startsWith("кп ") || n.includes("коалиция")) return "coalition";
  // ⚠ Overrides BEFORE the party marker: „ПП Движение 21 – ПП НДСВ" carries the prefix
  // and is a coalition of the two parties it names.
  const override = NOMINATOR_KIND_OVERRIDES[trimmed];
  if (override) return override;
  // „ПП" / „Политическа партия" is the register declaring a party, not an inference.
  if (n.startsWith("пп ") || n.startsWith("политическа партия "))
    return "party";
  // ⚠ NOT "party". See the banner above.
  return "unknown";
};

/**
 * Normalise an ЕКАТТЕ code to the width the settlement catalogue keys domestic
 * settlements on.
 *
 * ⚠ THE SOURCES DISAGREE ABOUT LEADING ZEROS AND THE CATALOGUE DOES NOT. Measured on
 * the 2021 presidential sections file: 10 codes are 2 characters, 250 are 3 and 1,230
 * are 4 — the zeros are stripped — while `data/settlements.json` keys domestic
 * settlements on a 5-character padded code (`00014`) and the 2026 parliamentary file
 * publishes them padded. Joining unpadded loses those ~1,490 sections' place, with
 * every count still reconciling because no vote depends on the join.
 *
 * ⚠ PADDING IS NECESSARY AND NOT SUFFICIENT, so do not read a successful pad as a
 * successful join. `settlements.json` is NOT uniformly 5-character: ~88 abroad entries
 * are keyed by ISO-2 country code and Sofia's 21 districts by a compound
 * (`68134-2302`). After padding, ~1,601 domestic sections still fail to resolve —
 * all of Sofia among them — and abroad resolves none of its 750. Closing that is the
 * aggregator's job (T3.1), not this function's.
 *
 * @param raw - The code as published.
 * @returns The code padded to 5, unchanged when already at least that wide (ABROAD
 *   codes are legitimately 6 digits, `100001`, and must not be touched), or
 *   `undefined` when the field is empty.
 */
export const normaliseEkatte = (raw: string): string | undefined => {
  const t = raw.trim();
  if (!t) return undefined;
  return t.length < 5 ? t.padStart(5, "0") : t;
};
