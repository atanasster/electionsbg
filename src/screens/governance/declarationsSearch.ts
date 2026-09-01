// The /governance/declarations finder's sources — pure data, no JSX.
//
// The hub fronts six leaderboards and a person browser. A reader who arrives knowing the
// name they want („Желязков") had to guess which tile contained them, land on /persons and
// search there. These are the groups that let them say the name instead.
//
// ===========================================================================
// THE DECLARATION FLAG RANKS, IT DOES NOT FILTER.
//
// This is a declarations hub, so "has filed" is the obvious thing to restrict on — and
// restricting is wrong for the same reason a scope is. Someone searching for a minister who
// has NOT filed is asking a question this page is exactly the right place to answer, and
// „no such person" is the one answer that is both wrong and unappealable.
//
// So: two groups, filers first, the rest below and labelled for what they are. The route's
// ?decl param exists to serve them as two ranked calls rather than one call the client
// splits — splitting a single ranked result silently empties the narrower group, which is
// the same failure `contested-votes` had when it ranked once and windowed afterwards.
// ===========================================================================
//
// EVERY GROUP IS SERVER-BACKED. 62,050 public figures is not a client index — the
// declarations blob on this page is ~1 KB and this would be three orders of magnitude more.

import {
  scopedSources,
  type HubSearchSource,
  type ServerSource,
} from "@/ux/search/hubSearchSources";
import {
  fetchPublicPeople,
  personAltQuery,
} from "@/screens/components/search/personSearchSource";

// The person rows, the request that fetches them and the „see all" needle all come from the
// shared adapter (`@/screens/components/search/personSearchSource`) rather than a private
// copy here. Two things that matters for:
//
//   - the in-flight promise is keyed by (query, decl), so this module's TWO calls per
//     keystroke stay two calls — scope RANKS and never filters, so the „has filed" and „has
//     not filed" groups must be two requests — while a `lastAltQuery` single slot shared
//     between them is gone;
//   - the destination, the identity caveat and the office label are decided in ONE place, so
//     this box cannot say something different about a person from what /procurement, the
//     governance finder or /person say.

// THERE IS DELIBERATELY NO "OFFICIALS" GROUP, and the reason is worth keeping.
//
// A first draft had one, built by calling the SAME person search with decl=1 and slicing to
// four. Three sets then disagreed: its content (anyone who has filed), its label
// („Класация на длъжностните лица") and its destination (/officials/assets, which applies
// fixedFilters is_exec=true). It also issued a byte-identical second request per keystroke
// and rendered the same people twice under two headings.
//
// person_search cannot express that group honestly: `is_exec` lives on
// officials_rankings_table and has no counterpart here, and position_type='executive' is a
// different set again. Officials ARE public figures with declarations, so the group above
// already finds them — a second heading over the same rows adds a claim, not a route.
//
// Reviving it needs an exec flag on person_search (the has_declaration shape, T3.7) AND
// OfficialsAssetsScreen reading ?q, which today it does not — so the link it would carry is
// a dead end even if the rows were right.

/** `?q=` seeds the destination's own search box — the convention the procurement tile and
 *  the combined-search deep links already use.
 *
 *  NO `&sector=all`. That widens /persons to tier P∪V, re-admitting the private
 *  Commerce-Registry owners this module excludes on principle — so the link would land on a
 *  broader set than the group that offered it. */
const personsSeeAll = (query: string, bg: boolean) => {
  // The needle the DECLARED group's rows actually came from. Read by (query, decl) rather
  // than from a single slot both groups wrote: this module issues two requests per keystroke
  // and the second to resolve would otherwise decide the first's link.
  const needle = personAltQuery(query);
  return {
    label: bg ? "Виж всички с декларация" : "See all who filed",
    to: `/persons?q=${encodeURIComponent(needle)}&decl=1`,
  };
};

export const declarationsSearchSources = (bg: boolean): HubSearchSource[] => [
  ...scopedSources<ServerSource>({
    id: "people",
    label: { bg: "Хора с декларация", en: "People who have filed" },
    // NAMES what it is outside, rather than „други". A reader must be able to tell why
    // these are second without inferring it.
    outLabel: {
      bg: "Без декларация в регистъра",
      en: "No declaration on record",
    },
    limit: 6,
    // No source-level `icon`: HubSearch reads that only for index sources, and every row
    // below sets its own anyway (a filing marker or a plain person).
    inSource: {
      kind: "server",
      fetch: (q, s) => fetchPublicPeople(q, s, bg, undefined, "1"),
      seeAll: (q) => personsSeeAll(q, bg),
    },
    outSource: {
      kind: "server",
      fetch: (q, s) => fetchPublicPeople(q, s, bg, undefined, "0"),
    },
  }),
];
