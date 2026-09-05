// `tickets.json` — both rounds' ballots for a cycle, with colours.
//
// ⚠⚠ A COLOUR IS A CLAIM ABOUT A POLITICAL BRAND, so this file says where each one came
// from. A ticket takes a party's colour only when its NOMINATOR NAME matches that party
// exactly in the parliamentary catalogue; everything else gets a neutral palette entry
// that asserts nothing. `colorBasis` carries the distinction into the file, because
// „ГЕРБ's blue, because the ticket says ГЕРБ" and „a colour so the chart has one" look
// identical on a screen and only the first is a fact.
//
// Measured: 14 of 23 nominators match in 2021, 4 of 18 in 2011, 4 of 21 in 2016, and NONE
// in 2001 or 2006 — those two bundles name no nominating body at all, for any ticket.
//
// ⚠ AND THE PARLIAMENTARY CATALOGUE HAS ITS OWN „COLOUR UNKNOWN" VALUE, WHICH IS NOT A
// COLOUR. `scripts/parsers/parties.ts` assigns `lightslategrey` to any party absent from
// `party_defaults.json`, and reads it back as the sentinel for „no colour known" — 143 of
// the 226 index entries carry it. Treating it as a brand fact stamped
// `colorBasis: "parliamentary-party"` on nine of 2021's fourteen matched tickets, all
// rendering as ONE grey a shade away from the neutral palette's first entry. It is
// therefore not a match for colour purposes; `PLACEHOLDER_COLOR` names it.
//
// ⚠ THE MATCH IS ON THE NOMINATOR'S NAME, NEVER ON THE TICKET NUMBER — but not because
// the two numberings disagree. On a same-day ballot they largely AGREE: all 14 numbers
// present in both of 2021's ballots name the identical formation, ticket 2 and party 2
// both being Русофили за възраждане на отечеството. That is exactly why matching on the
// number is dangerous — it works, until a cycle where the two sequences are drawn
// separately, and then it silently paints one formation's brand onto another's candidate.
// A name match cannot do that.
//
// Plan: docs/plans/presidential-elections-v1.md T3.3.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PresidentialRound, Ticket } from "./types";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** Curated labels for nominating bodies the parliamentary catalogue does not carry. */
export const TICKET_DEFAULTS_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "ticket_defaults.json",
);

export interface TicketDefaults {
  /**
   * Nominator name fold → the short label to render.
   *
   * ⚠ CURATED AND DELIBERATELY SPARSE. An entry here is somebody asserting that a
   * nominating body trades under a particular short name; it is not derivable, so the
   * table stays small and every addition is a decision. It NEVER supplies a colour — a
   * short label is a naming convenience and a colour is a brand claim.
   */
  nickNames: Record<string, string>;
}

/**
 * A neutral, deterministic palette.
 *
 * ⚠ IT ASSERTS NOTHING. These are chart colours for tickets whose nominator this repo
 * cannot identify — the 2001 and 2006 ballots name no nominating body at all — so they
 * are chosen for legibility beside each other. Reading one as a party colour would be
 * reading a decision that was never made.
 *
 * ⚠ 24 ENTRIES, WHICH IS ONE MORE THAN THE LARGEST BALLOT (2021's 23). At ten it wrapped,
 * and two candidates on the same ballot came out the same colour in three of the five
 * cycles — a chart cannot tell them apart, which is the one thing a neutral colour has to
 * do. Widen this before a longer ballot arrives; `neutralColor` wraps rather than
 * throwing, because a repeated colour is worse than a missing brand and not worse than a
 * failed build.
 */
export const NEUTRAL_PALETTE = [
  "rgb(96, 125, 139)",
  "rgb(121, 134, 203)",
  "rgb(77, 182, 172)",
  "rgb(255, 167, 38)",
  "rgb(161, 136, 127)",
  "rgb(149, 117, 205)",
  "rgb(38, 166, 154)",
  "rgb(255, 138, 101)",
  "rgb(141, 110, 99)",
  "rgb(79, 195, 247)",
  "rgb(174, 213, 129)",
  "rgb(255, 213, 79)",
  "rgb(240, 98, 146)",
  "rgb(129, 212, 250)",
  "rgb(165, 214, 167)",
  "rgb(255, 204, 128)",
  "rgb(179, 157, 219)",
  "rgb(128, 203, 196)",
  "rgb(255, 171, 145)",
  "rgb(188, 170, 164)",
  "rgb(144, 164, 174)",
  "rgb(159, 168, 218)",
  "rgb(197, 225, 165)",
  "rgb(255, 245, 157)",
] as const;

/**
 * The parliamentary catalogue's „no colour known" value.
 *
 * ⚠ NOT A COLOUR. `scripts/parsers/parties.ts` assigns it to any party it has no default
 * for, and tests `color !== "lightslategrey"` to ask whether a real one is known. A
 * ticket whose party carries it is NOT colour-matched — see the banner.
 */
export const PLACEHOLDER_COLOR = "lightslategrey";

/**
 * Nominator strings that name no particular body.
 *
 * ⚠ „Инициативен комитет" is what six of 2011's eighteen tickets give as their nominator
 * — it is the legal FORM of the nomination, not the identity of a formation — so matching
 * it would give six unrelated candidates one shared brand the moment any catalogue
 * happened to carry the phrase. Refused before the lookup rather than after.
 */
const GENERIC_NOMINATORS = new Set([
  "инициативен комитет",
  "ик",
  "независим",
  "независим кандидат",
]);

/** Whitespace- and case-insensitive key for a party or nominator name. */
export const nameKey = (name: string): string =>
  name.replace(/\s+/gu, " ").trim().toLowerCase();

interface CikParty {
  name: string;
  color?: string;
  nickName?: string;
}

let partyIndex: Map<string, CikParty> | null = null;

/** Where the derived, COMMITTED colour table lives. */
export const PARTY_COLORS_PATH = path.join(
  PROJECT_ROOT,
  "data/presidential/party_colors.json",
);

/**
 * Party name → its colour and short label.
 *
 * ⚠⚠ READ FROM A COMMITTED, DERIVED TABLE — NOT from `data/<cycle>/cik_parties.json`,
 * which is GITIGNORED — the gitignore rule for the per-election data trees covers it, 0
 * files tracked against 13 on disk. Reading them directly made `tickets.json` lose every
 * brand colour on a fresh
 * clone or a CI runner, at exit 0, with every vote figure still reconciling. Rebuild the
 * table with `build_party_colors.ts` when a parliamentary cycle lands.
 *
 * ⚠ The table already excludes the catalogue's `lightslategrey` placeholder, so anything
 * here carrying a `color` is a real brand fact.
 */
export const parliamentaryParties = (file?: string): Map<string, CikParty> => {
  if (!file && partyIndex) return partyIndex;
  const table = JSON.parse(
    fs.readFileSync(file ?? PARTY_COLORS_PATH, "utf8"),
  ) as { parties: Record<string, { color?: string; nickName?: string }> };
  const out = new Map<string, CikParty>();
  for (const [key, p] of Object.entries(table.parties)) {
    out.set(key, { name: key, ...p });
  }
  if (!file) partyIndex = out;
  return out;
};

let defaults: TicketDefaults | null = null;

/**
 * The curated table.
 *
 * @param file - Override the path; the seam a gate needs to exercise the table at all,
 *   since it ships empty by design.
 */
export const ticketDefaults = (file?: string): TicketDefaults => {
  if (!file && defaults) return defaults;
  const raw = JSON.parse(
    fs.readFileSync(file ?? TICKET_DEFAULTS_PATH, "utf8"),
  ) as TicketDefaults;
  // ⚠ A COPY, and a null-prototype one. The cache is module-level, so handing out the
  // parsed object lets any caller mutate what every later build reads; and the keys come
  // from JSON, so a plain object answers `nickNames["constructor"]` with a function.
  const table: TicketDefaults = {
    nickNames: Object.assign(Object.create(null), raw.nickNames ?? {}),
  };
  if (!file) defaults = table;
  return table;
};

/** Where a ticket's colour came from. */
export type ColorBasis =
  /** Its nominator matches a party in the parliamentary catalogue. */
  | "parliamentary-party"
  /** Nothing identified it; a neutral palette entry, asserting nothing. */
  | "neutral-palette";

export interface CatalogueTicket extends Ticket {
  color: string;
  colorBasis: ColorBasis;
  /** A short label, where one is known. ⚠ Absent rather than invented. */
  nickName?: string;
  /** The rounds this ticket stood in. */
  rounds: (1 | 2)[];
}

export interface TicketCatalogue {
  cycle: string;
  tickets: CatalogueTicket[];
  /**
   * Nominator names no party matched, so a reader can see what the colours rest on.
   *
   * ⚠ Empty is not the goal. 2001 and 2006 name no nominator for any ticket, so their
   * entire ballots are neutral by construction and always will be.
   */
  unmatchedNominators: string[];
  /**
   * How many TICKETS carry a colour that asserts nothing.
   *
   * ⚠ Not the length of `unmatchedNominators`: several tickets can share one nominator
   * string, and 2001 and 2006 have no nominators at all yet are entirely neutral.
   */
  neutralTickets: number;
  /**
   * Colours carried by more than one ticket on this ballot.
   *
   * ⚠ REPORTED, NOT RESOLVED, because the only case in the corpus is two REAL brand
   * colours: the parliamentary catalogue gives Патриотичен фронт and ВМРО the same red,
   * and both of their 2021 nominees inherit it. That is the catalogue's own statement
   * about two related formations, and overriding one here would replace a published
   * brand fact with a colour this module invented. A chart that must tell them apart
   * should read this and vary something other than the hue.
   */
  colorCollisions: { color: string; tickets: number[] }[];
}

/** A neutral colour, distinct from every other on the same ballot. */
const neutralColor = (assignedSoFar: number): string =>
  // ⚠ Indexed by ORDER OF ASSIGNMENT, not by ticket number. A ballot whose numbers are
  // sparse — or start above the palette length — would otherwise wrap and collide while
  // most of the palette went unused; and a number of 0 or below (nothing in the corpus,
  // but `Number()` yields one from a malformed row) would index out of the array.
  NEUTRAL_PALETTE[assignedSoFar % NEUTRAL_PALETTE.length];

/**
 * Build a cycle's ticket catalogue from its rounds.
 *
 * @param rounds - Round 1, and the runoff when there was one.
 * @returns One entry per ticket NUMBER across both rounds, with the rounds it stood in.
 * @throws If two rounds give one ticket number two different people — see the swing's
 *   join in `nationalSummary.ts` for the same hazard.
 */
export const buildTicketCatalogue = (
  rounds: PresidentialRound[],
  options: { defaultsFile?: string; partyColorsFile?: string } = {},
): TicketCatalogue => {
  if (!rounds.length) throw new Error("tickets: no rounds");
  const parties = parliamentaryParties(options.partyColorsFile);
  const { nickNames } = ticketDefaults(options.defaultsFile);

  const byNumber = new Map<number, CatalogueTicket>();
  const unmatched = new Set<string>();
  let neutralCount = 0;

  for (const round of rounds) {
    for (const t of round.tickets) {
      const existing = byNumber.get(t.number);
      if (existing) {
        // ⚠ The same check `nationalSummary`'s swing makes, for the same reason: a
        // renumbered runoff would otherwise merge two people into one catalogue entry.
        // ⚠ BOTH names, folded. A runoff that re-spelled a running mate is not a
        // different person, and a president compared raw would refuse on a stray space.
        if (
          nameKey(existing.president) !== nameKey(t.president) ||
          nameKey(existing.vicePresident) !== nameKey(t.vicePresident)
        ) {
          throw new Error(
            `tickets: ${round.cycle} ticket ${t.number} is "${existing.president}" / ` +
              `"${existing.vicePresident}" in one round and "${t.president}" / ` +
              `"${t.vicePresident}" in another`,
          );
        }
        if (!existing.rounds.includes(round.round)) {
          existing.rounds.push(round.round);
        }
        continue;
      }

      const key = nameKey(t.nominatedBy.name);
      // ⚠ A generic nomination form is not a formation — see `GENERIC_NOMINATORS`.
      const lookupKey = key && !GENERIC_NOMINATORS.has(key) ? key : "";
      const party = lookupKey
        ? Object.prototype.hasOwnProperty.call(nickNames, lookupKey) ||
          parties.has(lookupKey)
          ? parties.get(lookupKey)
          : undefined
        : undefined;
      // ⚠ The placeholder is not a colour. A party carrying it is still a match for its
      // SHORT LABEL, which is a real fact, but not for a brand colour.
      const brandColor =
        party?.color && party.color !== PLACEHOLDER_COLOR
          ? party.color
          : undefined;
      if (lookupKey && !brandColor) unmatched.add(t.nominatedBy.name);
      const nick =
        party?.nickName ??
        (lookupKey && Object.prototype.hasOwnProperty.call(nickNames, lookupKey)
          ? nickNames[lookupKey]
          : undefined);

      // ⚠ The reader's own ticket is spread FIRST and these overwrite it, so a `color` or
      // `nickName` that arrived on a `Ticket` cannot slip past the vetting above.
      byNumber.set(t.number, {
        ...t,
        color: brandColor ?? neutralColor(neutralCount++),
        colorBasis: brandColor ? "parliamentary-party" : "neutral-palette",
        ...(nick ? { nickName: nick } : {}),
        rounds: [round.round],
      });
    }
  }

  const tickets = [...byNumber.values()].sort((a, b) => a.number - b.number);
  return {
    cycle: rounds[0].cycle,
    tickets,
    unmatchedNominators: [...unmatched].sort((a, b) => a.localeCompare(b)),
    // ⚠ NAMES AND TICKETS ARE DIFFERENT COUNTS, and conflating them under-states. Six of
    // 2011's tickets share the one nominator string „Инициативен комитет", so its 14
    // unmatched NAMES stand for 9 unmatched tickets — a reader asking „how much of this
    // ballot carries a colour that asserts nothing" wants the second.
    neutralTickets: tickets.filter((t) => t.colorBasis === "neutral-palette")
      .length,
    colorCollisions: [
      ...tickets
        .reduce((m, t) => {
          m.set(t.color, [...(m.get(t.color) ?? []), t.number]);
          return m;
        }, new Map<string, number[]>())
        .entries(),
    ]
      .filter(([, numbers]) => numbers.length > 1)
      .map(([color, numbers]) => ({ color, tickets: numbers }))
      .sort((a, b) => a.color.localeCompare(b.color)),
  };
};
