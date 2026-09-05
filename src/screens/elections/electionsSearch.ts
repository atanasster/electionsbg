// The `/elections` finder — a `HubSearch` CONFIGURATION, not a new search surface (§6.2).
//
// ⚠ IT BUILDS NO NEW INDEX AND ADDS NO NEW ENDPOINT. The rows are `buildPlaceItems` — the SLIM
// place catalog the My-Area autocomplete and the global home already use, not the fat
// `useSearchItems`, which additionally pulls ~4.4 MB this box would immediately discard. So a
// keystroke here costs ZERO requests, and the catalog itself is fetched only once `HubSearch`
// arms (focus or first keystroke), which is why the screen passes `armed` down.
//
// ⚠ WHAT IS DIFFERENT FROM THE HOME FINDER IS THE DESTINATION, and it is the whole reason this
// file exists rather than reusing `homePlaceIndex`. From the global home a place goes to
// `/governance/<id>`, its place dashboard. From here it goes to that place's RESULT for the
// cycle the hub resolved — which is a different page, and for a local cycle a differently
// shaped URL (Sofia's synthetic `SOF` bundle, the Пловдив/Варна район rows). Both come from
// `placeViewUrl`/`localUrl` rather than a template, so the special cases are the router's.
//
// ⚠ SCOPE RANKS, IT NEVER FILTERS, and the two halves are INDEPENDENT SOURCES with their own
// caps — never one ranked scan partitioned afterwards. A partition can only surface an
// out-of-scope row if the ranked scan reached one, so with ~5,000 in-scope settlements ranked
// above 88 diaspora ones the second group renders empty and the box has silently become a
// filter. `scopedSources()` mints the pair.

import { MapPin, Star } from "lucide-react";
import type {
  HubSearchSource,
  IndexSource,
} from "@/ux/search/hubSearchSources";
import { scopedSources } from "@/ux/search/hubSearchSources";
import { buildEntityIndex } from "@/lib/entitySearchIndex";
import { decodeEntities } from "@/lib/decodeEntities";
import type { SearchIndexType } from "@/data/search/useSearchItems";
import { localUrl, placeViewUrl, type PlaceRef } from "@/data/local/placeViews";
import {
  PRESIDENTIAL_CATALOGUE,
  type PresidentialElectionEntry,
} from "@/data/presidentialCatalogue";
import {
  CYCLE_SURFACE,
  KINDS_WITHOUT_SURFACE,
  type ElectionsHubKind,
} from "./electionsHubCycle";

/** Coarser grains first — the same rank the home finder uses, and for the same measured
 *  reason: without it, 11 of 294 municipalities („Бяла", „Ново село", „Лом", „Трън" …) are
 *  unreachable by their own exact name behind settlements that merely contain the string. */
const PLACE_RANK: Partial<Record<SearchIndexType["type"], number>> = {
  r: 3,
  m: 2,
  d: 2,
  s: 1,
};

/** A catalog row → the `PlaceRef` the router's URL builders take.
 *
 *  ⚠ THE ROW'S `type` IS THE LEVEL, and the mapping is not the identity: a Sofia район is `d`
 *  in the catalog and a `municipality` to the local URL builder, which is what turns it into
 *  `/local/<cycle>/S2xxx` rather than a settlement page that does not exist. */
export const placeRefOf = (i: SearchIndexType): PlaceRef | null => {
  switch (i.type) {
    case "r":
      return { level: "region", oblast: i.key };
    case "m":
    case "d":
      return { level: "municipality", obshtina: i.key };
    case "s":
      return { level: "settlement", ekatte: i.key };
    default:
      return null;
  }
};

/** Where a place goes from this hub, for the cycle it resolved.
 *
 *  ⚠ NULL IS AN ANSWER, and it is what the out-of-scope group is made of. A diaspora
 *  settlement has a parliamentary result and no local one — „Местни избори не се произвеждат
 *  в чужбина" — so for a local cycle `localUrl` legitimately declines it. */
export const electionPlaceHref = (
  i: SearchIndexType,
  cycle: { kind: ElectionsHubKind; id: string },
): string | null => {
  const ref = placeRefOf(i);
  if (!ref) return null;
  switch (cycle.kind) {
    case "local":
      return localUrl(ref, cycle.id);
    case "parliamentary":
      return placeViewUrl("parliamentary", ref);
    case "presidential":
      // ⚠ UNREACHABLE TODAY, AND `null` RATHER THAN A GUESS. `resolveHubCycle` refuses to
      // return a kind in `KINDS_WITHOUT_SURFACE`, so this arm cannot be entered while the
      // presidential screens are unbuilt — gated by `electionsHubCycle.test.ts`. Declining
      // the row puts it in the out-of-scope group; reusing the parliamentary place view
      // would send a reader to a page describing a different election under the label of
      // the one they picked.
      //
      // ⚠ THE DECISION IS TIER 5's, NOT T4.8's. That step made the CYCLES findable and
      // deliberately did not touch place routing, because there is no per-place
      // presidential surface to route to yet. Both halves belong to whichever step builds
      // one: where a place goes, AND what the group it falls into is called — the caller
      // heads that group „Места без местен вот (секции в чужбина)", true for the local
      // cycle it was written for and false about every settlement in the country under a
      // presidential one. Declining is only safe while this arm is unreachable.
      return null;
  }
};

/** ⚠ ABROAD IS THE OUT-OF-SCOPE POPULATION, and it is decided by the DESTINATION rather than
 *  by a `oblast === "32"` test of its own. One rule, read once: if the cycle's URL builder
 *  cannot place the row, it is out of scope — so a future kind of place the builder declines
 *  joins the group automatically instead of vanishing from the box. */
const partition = (
  items: SearchIndexType[],
  cycle: { kind: ElectionsHubKind; id: string },
) => {
  const inScope: SearchIndexType[] = [];
  const outScope: SearchIndexType[] = [];
  for (const i of items) {
    if (!placeRefOf(i)) continue;
    (electionPlaceHref(i, cycle) ? inScope : outScope).push(i);
  }
  return { inScope, outScope };
};

const indexOf = (
  items: SearchIndexType[],
  href: (i: SearchIndexType) => string,
) =>
  buildEntityIndex<SearchIndexType>(
    items,
    (i) => ({
      id: `${i.type}-${i.key}`,
      href: href(i),
      label: decodeEntities(i.name),
      // The parent — „общ. Сливен", „обл. Сливен" — is what separates the fourteen Bulgarian
      // settlements that share a name from one another.
      sub: i.parentName ? decodeEntities(i.parentName) : undefined,
    }),
    // Both spellings, so a Latin-keyboard reader finds a Cyrillic place.
    (i) => [i.name, i.name_en],
    (i) => PLACE_RANK[i.type] ?? 0,
  );

export const ELECTIONS_SEARCH_LIMIT = 6;

/**
 * The presidential cycles, findable by year and by the name of the president they elected.
 *
 * ⚠ IT SEARCHES THE CATALOGUE, NOT THE FULL BALLOT — five cycles and five winners, against
 * the 75 tickets those cycles actually carried. The rosters live in `data/<cycle>/tickets.json`,
 * bucket-served, and putting them in the catalogue instead would move ~4 KB of names onto the
 * ENTRY CHUNK to serve a search box most readers never open. Widening this to every candidate
 * is a fetch-on-arm source over the published tree, which needs that tree published (Tier 7);
 * until then the group's own copy must not promise more than it holds.
 *
 * ⚠ AND IT IS WITHHELD while `/presidential/:cycle` does not exist, on the same list the hub,
 * the header and the tile registry read. A search result that navigates to a 404 is worse than
 * a query that finds nothing: the reader has been told the page exists.
 *
 * @param label - The group heading, per language.
 * @param withheld - Kinds with no surface. ⚠ A SEAM, defaulting to the real list, because
 *   the source is withheld TODAY: without it the whole index — every href, every search key
 *   — ships untested and the first person to see it is a reader.
 * @returns One source, or `null` while the kind has no surface.
 */
export const presidentialSearchSource = (
  label: { bg: string; en: string },
  withheld: readonly ElectionsHubKind[] = KINDS_WITHOUT_SURFACE,
): HubSearchSource | null => {
  if (withheld.includes("presidential")) return null;
  return {
    kind: "index",
    id: "election-presidential",
    label,
    icon: Star,
    limit: ELECTIONS_SEARCH_LIMIT,
    index: buildEntityIndex<PresidentialElectionEntry>(
      PRESIDENTIAL_CATALOGUE,
      (e) => ({
        id: `presidential-${e.name}`,
        href: CYCLE_SURFACE.presidential.href(e.name),
        // ⚠ THE YEAR, NOT THE FOLDER ID. „2021_11_14_pvr" is a key; this module's siblings
        // learned the same lesson on `_mi`.
        label: `${e.round1Date.slice(0, 4)} — ${e.winnerTicket.president}`,
        sub: e.winnerTicket.vicePresident,
      }),
      // ⚠ THE VICE-PRESIDENT IS A SEARCH KEY TOO. A ticket is a pair, and a reader looking
      // for Йотова is looking for a person who was on the ballot and won.
      //
      // ⚠ AND NAME PARTS GO IN SEPARATELY. `latinSkeleton` strips whitespace, so a whole
      // name folds to ONE token and „Радев" — the natural query for this corpus — could
      // only ever reach the CONTAINS tier, behind anything whose given name prefix-matches.
      // Invisible at five rows against a limit of six; a truncation the day this widens to
      // the 75 tickets those cycles carried.
      (e) => [
        e.round1Date.slice(0, 4),
        ...e.winnerTicket.president.split(/\s+/),
        ...e.winnerTicket.vicePresident.split(/\s+/),
      ],
      // Newest first, matching every other cycle list on this hub. ⚠ The WHOLE date, not
      // the year: two cycles in one calendar year would otherwise tie and fall back to
      // catalogue order — correct today by coincidence rather than by construction, which
      // is what `ELECTION_EVENTS`' „sorted here rather than trusted" is about.
      (e) => Number(e.round1Date.replace(/-/g, "")),
    ),
  };
};

export const electionsSearchSources = (
  /** `null` while the catalog is unarmed or still in flight — a state, not an absence. */
  items: SearchIndexType[] | null,
  cycle: { kind: ElectionsHubKind; id: string },
  label: {
    inScope: { bg: string; en: string };
    outScope: { bg: string; en: string };
  },
): HubSearchSource[] => {
  const parts = items ? partition(items, cycle) : null;
  return scopedSources<IndexSource>({
    id: "election-places",
    label: label.inScope,
    // ⚠ NAMED FOR THE SCOPE IT IS OUTSIDE, never „други" — the same reason a band is never
    // called „Още".
    outLabel: label.outScope,
    limit: ELECTIONS_SEARCH_LIMIT,
    inSource: {
      kind: "index" as const,
      icon: MapPin,
      index: parts
        ? indexOf(parts.inScope, (i) => electionPlaceHref(i, cycle)!)
        : null,
      loading: items === null,
    },
    // ⚠ THE PAIR COLLAPSES TO ONE GROUP WHEN NOTHING IS OUT OF SCOPE. Every place has a
    // parliamentary result, so on a parliamentary cycle a second group would render an empty
    // heading on every query. `scopedSources` takes a null out-source for exactly this.
    outSource:
      parts && parts.outScope.length > 0
        ? {
            kind: "index" as const,
            icon: MapPin,
            // Their PARLIAMENTARY page — the row is a real place with a real result, it is
            // only this cycle it is outside of. A row that links nowhere is worse than absent.
            index: indexOf(
              parts.outScope,
              (i) => placeViewUrl("parliamentary", placeRefOf(i)!) ?? "/",
            ),
          }
        : null,
  });
};

/**
 * Every source the `/elections` finder offers, places first.
 *
 * ⚠ THE COMPOSITION LIVES HERE, NOT IN THE COMPONENT, so „is the presidential group
 * appended at all" is testable through the same `withheld` seam. In the screen it was a
 * `useMemo` no gate could reach: a dropped memo or a hardcoded default would leave the group
 * silently absent the day its route lands, with every test still green.
 *
 * @param items - The place catalog, or `null` while unarmed / in flight.
 * @param cycle - The resolved hub cycle.
 * @param label - Group headings: the place pair, and the presidential group's own.
 * @param withheld - Kinds with no surface; defaults to the real list.
 * @returns The place sources, plus the presidential group when it is servable.
 */
export const electionsHubSources = (
  items: SearchIndexType[] | null,
  cycle: { kind: ElectionsHubKind; id: string },
  label: {
    inScope: { bg: string; en: string };
    outScope: { bg: string; en: string };
    presidential: { bg: string; en: string };
  },
  withheld: readonly ElectionsHubKind[] = KINDS_WITHOUT_SURFACE,
): HubSearchSource[] => {
  const places = electionsSearchSources(items, cycle, label);
  const presidential = presidentialSearchSource(label.presidential, withheld);
  return presidential ? [...places, presidential] : places;
};
