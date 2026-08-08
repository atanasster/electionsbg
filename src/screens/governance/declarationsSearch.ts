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

import { FileText, Users } from "lucide-react";
import type { SearchItem } from "@/ux/search/EntitySearchTile";
import {
  scopedSources,
  type HubSearchSource,
  type ServerSource,
} from "@/ux/search/hubSearchSources";
import { decodeEntities } from "@/lib/decodeEntities";
import { positionLabel } from "@/screens/components/procurement/personSearchGroups";

/** The subset of /api/db/person-search a row needs here. */
interface PersonHit {
  key: string;
  name: string;
  /** A CODE (executive / magistrate / …), not a label. See `positionLabel`. */
  position_type: string | null;
  place_label: string | null;
  href: string;
  has_declaration: boolean;
}

/** The three tiers the route returns. Only `power` is used: V and N are private company
 *  owners reached through the Commerce Registry, who are not in the declarations register
 *  and have no business on this page. */
interface PersonSearchResponse {
  power?: PersonHit[];
  /** The shliokavitsa-rewritten needle the rows came from, or null. */
  altQuery?: string | null;
}

/** The needle the LAST response actually answered, when it differs from what was typed.
 *
 *  A see-all built from the typed query is a dead end whenever the rewrite fired: „Jelqzkov"
 *  previews Желязков here and /persons?q=Jelqzkov returns nothing, because the browse table
 *  runs its own search and does not carry the rewrite. The route returns `altQuery` for
 *  exactly this and ProcurementSearchTile already honours it.
 *
 *  MODULE-LEVEL because `seeAll` is called during render with only the query string, while
 *  the value arrives with the fetch. One box per page, one query at a time, and a stale
 *  value can only ever produce the link the previous query would have — never a wrong page
 *  for a query that had no rewrite, since it is cleared on every response. */
let lastAltQuery: { typed: string; alt: string } | null = null;

const fetchPeople = async (
  query: string,
  signal: AbortSignal,
  decl: "1" | "0",
  bg: boolean,
): Promise<SearchItem[]> => {
  const r = await fetch(
    // No &limit: the route caps each tier at 6 internally and `limit` only sizes the
    // back-compat `people` array, which this consumer never reads.
    `/api/db/person-search?q=${encodeURIComponent(query)}&decl=${decl}`,
    { signal },
  );
  // Throw rather than return []: HubSearch tells a failed fetch apart from an empty one and
  // omits a failed group from its "searched in: …" sentence. Swallowing the error here would
  // report our own outage as an absence of people.
  if (!r.ok) throw new Error(`person-search: ${r.status}`);
  const body = (await r.json()) as PersonSearchResponse;
  lastAltQuery = body.altQuery ? { typed: query, alt: body.altQuery } : null;
  return (body.power ?? []).map((p) => ({
    id: p.key,
    to: p.href,
    primary: decodeEntities(p.name),
    // Role and place, which is what distinguishes two people of the same name — and the
    // register is full of them.
    //
    // position_type is a CODE. Rendering it raw shipped „state_enterprise" and
    // „security_service" to a Bulgarian reader in the first draft; `positionLabel` is the
    // one map, shared with the procurement box so the two cannot disagree.
    secondary:
      [positionLabel(p.position_type, bg), p.place_label]
        .filter(Boolean)
        .map((x) => decodeEntities(String(x)))
        .join(" · ") || undefined,
    icon: p.has_declaration ? FileText : Users,
  }));
};

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
  const needle =
    lastAltQuery && lastAltQuery.typed === query ? lastAltQuery.alt : query;
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
      fetch: (q, s) => fetchPeople(q, s, "1", bg),
      seeAll: (q) => personsSeeAll(q, bg),
    },
    outSource: {
      kind: "server",
      fetch: (q, s) => fetchPeople(q, s, "0", bg),
    },
  }),
];
