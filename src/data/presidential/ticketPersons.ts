// A presidential ticket's name → its `/person/<slug>` page, from the committed map.
//
// ⚠⚠ THE MAP REFUSES MORE OFTEN THAN IT LINKS, AND THAT IS THE POINT. Measured 2026-09-06 over
// all five ballots: 140 names, 78 linked, 17 refused because more than one public figure shares
// the name fold („Иван Стефанов Иванов" matches 15), and 45 not in the person layer at all.
// Linking a shared name would attribute an election — and everything else on that profile:
// declared wealth, company roles, sanctions facets — to somebody who merely shares a name.
// There is no „best match" here and there must never be one.
//
// ⚠ IT IS A SNAPSHOT, NOT A LOOKUP. The presidential tree has no database, so the resolution
// happens at build time (`scripts/parsers_presidential/build_ticket_persons.ts`) and ships as
// JSON. A person re-slugged after that ran keeps the old target until it is re-run — which is
// exactly what `person_slug_retired`'s 301s exist for, so the link degrades to a redirect
// rather than a 404.

import map from "../../../data/presidential/ticket_persons.json";

export type TicketPersonLink = {
  name: string;
  slug?: string;
  /** ⚠ TWO REFUSALS, NOT ONE. „nobody by that name is a public figure" and „more than one is"
   *  are different facts, and only the second is about ambiguity. */
  reason?: "not_found" | "ambiguous";
  /** Public figures sharing the fold — what the LINK rule is decided on. */
  candidates: number;
  /** Person rows sharing it at all, public or not. */
  people: number;
  /** ⚠ `null` MEANS UNMEASURED, NEVER 1 — `081_person_identity.sql` says so about
   *  `fold_people_n`, and 40 of the 78 links carry a null. */
  foldPeople: number | null;
  /** `block` is the weaker key — a two-part ballot spelling matched on (given, family). */
  basis?: "fold" | "block";
};

const LINKS = (map as { links: Record<string, TicketPersonLink> }).links;

/**
 * @param name - The ticket's Bulgarian name, exactly as `tickets.json` prints it.
 * @returns The person page, or `null` where the map refused or never saw the name.
 */
export const personHrefForTicket = (name?: string): string | null => {
  if (!name) return null;
  const hit = LINKS[name.trim()];
  return hit?.slug ? `/person/${hit.slug}` : null;
};

/**
 * How many people are known to share this name — the number a surface may WARN with.
 *
 * ⚠⚠ IT IS NOT THE NUMBER THE LINK RULE USES, and conflating the two hides the case that
 * matters. `candidates` counts PUBLIC FIGURES, so a fold with one public figure and three
 * private rows is a legitimate link — and a name three other people carry, about which
 * `candidates: 1` says nothing. This takes the largest of the three counts the map records, so
 * the warning fires on any of them. Measured: 5 of the 78 links have 2–3 registry people on
 * their fold and would otherwise have rendered as unshared.
 *
 * ⚠ A NULL `foldPeople` IS UNMEASURED AND CONTRIBUTES NOTHING — `081_person_identity.sql` says
 * it must never be rendered as 1, and reading it as such would publish „this name is unique"
 * about a fold nobody has counted.
 */
export const namesakeCountForTicket = (name?: string): number => {
  const hit = name ? LINKS[name.trim()] : undefined;
  if (!hit) return 0;
  return Math.max(hit.candidates ?? 0, hit.people ?? 0, hit.foldPeople ?? 0);
};
