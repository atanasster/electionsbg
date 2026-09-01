// Pure builder for the three ranked people tiers in the combined-search dropdown, split out of
// ProcurementSearchTile so the encoding split, the name-match label, the position-type label
// fallback and the empty-tier guard are unit-tested (like fundSearchGroup). Consumes the shape
// /api/db/person-search (S1) returns.
//
// ⚠️ THE PURE PIECES NOW LIVE IN `@/screens/components/search/personSearchSource` and are
// re-exported here, so the four boxes that read this endpoint — /procurement's combined
// search, the two governance finders and the global home — cannot disagree about a person's
// DESTINATION, their identity CAVEAT, or their office LABEL. Two of those were live defects
// when this file owned them:
//
//   - `personTo` branched on the TIER, so 69,367 of 84,557 V rows — the ones with a real
//     `slug:` key and a real /person/<slug> href — were routed to the name-keyed page
//     instead, which is precisely what load_person_search_pg's V-real arm exists to prevent;
//   - `identity_confidence = 'shared_name'` got NO caveat at all (4,376 rows), while /person
//     and /persons both render the stronger „several people" warning for it.
//
// Plan: docs/plans/home-search-expansion-v1.md §2.4 + §3.3.

import { Landmark, Users, Coins } from "lucide-react";
import type { To } from "react-router-dom";
import type { SearchGroup } from "@/ux/search/EntitySearchTile";
import { decodeEntities } from "@/lib/decodeEntities";
import {
  firmsSubtitle,
  personHref,
  positionLabel,
  roleSubtitle,
  type PersonHit,
  type RoleLabeler,
} from "@/screens/components/search/personSearchSource";

export type { PersonHit };
/** Exported so the declarations hub's finder uses the SAME map. Two copies would mean one
 *  box shows „Изпълнителна власт" and the other shows `executive`, which is the raw-code
 *  leak that table exists to prevent. Owned by personSearchSource. */
export { positionLabel };

export interface PersonSearchResult {
  power: PersonHit[];
  money: PersonHit[];
  others: PersonHit[];
  /** The shliokavitsa-rewritten needle these rows came from, or null. /persons runs its own
   *  search and does not carry the rewrite, so a "see all" must use this when present. */
  altQuery: string | null;
}
export const EMPTY_PEOPLE: PersonSearchResult = {
  power: [],
  money: [],
  others: [],
  altQuery: null,
};

/** The three people groups, in tier order. An empty tier yields no group (no stray header).
 *  `seeAllPersons` is the "виж всички хора" target appended to the others (N) tier.
 *
 *  `roleLabel` is optional and comes from `usePersonLabels()`. With it a public row reads
 *  „Кмет · Столична община"; without it, the broad facet („Политик"), which is true of 46,159
 *  people and is what this line exists to disambiguate. */
export const buildPersonGroups = (
  people: PersonSearchResult,
  bg: boolean,
  seeAllPersons: To,
  roleLabel?: RoleLabeler,
): SearchGroup[] => {
  const g: SearchGroup[] = [];
  if (people.power.length > 0)
    g.push({
      key: "power",
      label: bg ? "Хора във властта" : "People in power",
      items: people.power.map((h) => ({
        id: `pw-${h.key}`,
        to: personHref(h),
        primary: decodeEntities(h.name),
        // Office + place. `party` is an internal canonicalId (e.g. "p_97"), not a display
        // name, so it is deliberately not shown here.
        secondary: roleSubtitle(h, bg, roleLabel),
        amountEur: h.public_money_eur,
        icon: Landmark,
      })),
    });
  if (people.money.length > 0)
    g.push({
      key: "money",
      label: bg ? "Свързани с обществени пари" : "Linked to public money",
      items: people.money.map((h) => ({
        id: `mn-${h.key}`,
        to: personHref(h),
        primary: decodeEntities(h.name),
        secondary: firmsSubtitle(h, bg),
        amountEur: h.public_money_eur,
        icon: Coins,
      })),
    });
  if (people.others.length > 0)
    g.push({
      key: "others",
      label: bg ? "Други собственици" : "Other owners",
      seeAll: {
        label: bg ? "Виж всички хора" : "See all people",
        to: seeAllPersons,
      },
      items: people.others.map((h) => ({
        id: `ot-${h.key}`,
        to: personHref(h),
        primary: decodeEntities(h.name),
        secondary: firmsSubtitle(h, bg),
        icon: Users,
      })),
    });
  return g;
};
