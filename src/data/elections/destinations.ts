// The surface's DESTINATIONS — every cross-link a place's surface carries, in the module both
// runtimes can read.
//
// ⚠ IT MOVED OUT OF THE GENERATOR FOR THE SAME REASON THE BALLOT RULES DID. `source_links.ts`
// opens with `node:fs`, so a `canonical` level's client-side adapter (§5.0) could not import
// it — and the alternative was a second route-building rule beside this one, differing exactly
// where it is hardest to see: which views a level omits, and whether an unresolvable link is
// absent or `available: false` with a reason. The generator re-exports every name here.
//
// ⚠ ROUTES COME FROM THE ROUTER'S OWN BUILDERS (`placeViewUrl` / `localUrl`), never from a
// template. A hand-built path keeps working until the routing rule moves, and then nothing
// compares the two — which is how Sofia's synthetic `SOF` bundle and the Пловдив/Варна район
// rows get quietly wrong.

import {
  localUrl,
  placeViewUrl,
  presidentialViewUrl,
  type PlaceRef,
  type PlaceView,
} from "@/data/local/placeViews";
import { presidentialUrl } from "./presidentialRoutes";
import type {
  ElectionDestination,
  ElectionDestinations,
  ElectionKind,
  ElectionPlaceLevel,
  ElectionUnavailableReason,
  PlaceViewName,
} from "./surfaceTypes";

/** The five views, in `PlaceViewNav`'s order — imported rather than restated would be better,
 *  but the nav's order lives in `PLACE_DIGEST_ORDER` (a browser module the generator already
 *  imports) and this is the same list; `source_links.test.ts` asserts they agree. */
export const VIEW_NAMES: readonly PlaceViewName[] = [
  "governance",
  "parliamentary",
  "presidential",
  "local",
  "consumption",
];

/** ⚠ TWO LEVEL VOCABULARIES, AND THEY DIFFER BY EXACTLY ONE MEMBER. `ElectionPlaceLevel` has
 *  `abroad`; the router's `PlaceLevel` does not, because there is no governance, consumption or
 *  local page for "чужбина" — it is a parliamentary-only place. Mapping it onto `country` (the
 *  tempting default, since abroad's parent is the country) would emit four live view links that
 *  all resolve to Bulgaria's pages for a place that is not in Bulgaria. It has no `PlaceRef`. */
export const toPlaceRef = (
  level: ElectionPlaceLevel,
  id: string,
): PlaceRef | null => {
  switch (level) {
    case "abroad":
      return null;
    case "country":
      return { level: "country" };
    case "region":
      return { level: "region", oblast: id };
    case "municipality":
      return { level: "municipality", obshtina: id };
    case "settlement":
      return { level: "settlement", ekatte: id };
    case "section":
      // A section's cross-view links resolve through its PARENT SETTLEMENT — section numbering
      // is not stable across cycles, so the settlement is the finest granularity that
      // cross-links reliably (see `parliamentaryUrl`). The caller passes the parent ekatte.
      return { level: "section", ekatte: id };
  }
};

const dest = (
  to: string | null,
  reason: ElectionUnavailableReason,
): ElectionDestination =>
  to ? { to, available: true } : { to: "", available: false, reason };

export type DestinationInput = {
  kind: ElectionKind;
  level: ElectionPlaceLevel;
  /** The place's own id — oblast / obshtina / ekatte / section code. */
  id: string;
  /** The cycle this surface belongs to. */
  cycle: string;
  /** ⚠ DELIBERATELY ABSENT. It was here "for a section or settlement, the EKATTE its
   *  cross-view links resolve through" and did neither job: a section returns before `views`
   *  is built at all (§4.1 omits them), so it was dead there — while for a SETTLEMENT it
   *  silently replaced the place's own id, so `{ level: "settlement", id: "68134",
   *  parentEkatte: "99999" }` emitted `/governance/99999` and `/consumption/99999`, both
   *  `available: true`, i.e. this settlement's surface linking to a different place. A field
   *  whose only reachable effect is to misroute is removed, not documented. */
  /** The local cycle to point `views.local` at, when one covers this place. Absent means no
   *  local cycle covers it — which is a rendered answer, not a missing link. */
  localCycle?: string;
  /** Whether this place actually appears in `localCycle`. The caller checks the cycle index;
   *  a resolvable URL is not evidence that a place has data behind it. */
  inLocalCycle?: boolean;
  /** The presidential cycle to point `views.presidential` at.
   *
   *  ⚠ NOT EVERY PRODUCER THREADS THIS YET — `destinations.views` has no reader today (see
   *  `ElectionResultsShell.tsx`'s own note), so leaving it unset here is inert rather than a
   *  rendered defect. Unlike `inLocalCycle`, there is no matching "was this place covered"
   *  flag: presidential's code-shape declines (Sofia's city aggregate and райони, a composite
   *  settlement id) already live in `presidentialViewUrl`, and an uncovered ordinary place
   *  still resolves to an honest "not published" page rather than a 404 — see that function's
   *  header for why the presidential pill needs no availability index the way `local` does. */
  presidentialCycle?: string;
  /** Route to the complete result for this place, from the caller's own routing helper. */
  completeResultTo: string | null;
  childPlacesTo?: string | null;
  parentPlaceTo?: string | null;
  officialProtocolTo?: string | null;
};

/** ⚠ `views` IS ABSENT AT SECTION LEVEL, not empty. Governance, consumption and local all stop
 *  above the polling section, so a section would carry four entries of which three are
 *  `available: false` — four rows of "this does not exist here" under a heading promising
 *  where to go next. §4.1 drops the digest entirely on a section for the same reason. */
/** The route of the page a surface is RENDERED on, so a destination equal to it can be refused.
 *
 *  @param kind - Which election family this surface belongs to; each has its own page routes.
 *  @param level - The place level, which is what decides whether a "self" page exists at all.
 *  @param id - The place's own id.
 *  @param cycle - The surface's cycle. Only the presidential family's routes carry it; the
 *    parliamentary pages are cycle-less and the local ones take `localCycle` instead.
 *  @param localCycle - The local cycle whose pages a `local` surface is rendered on.
 *
 *  ⚠ SECTION IS EXEMPT FOR THE PARLIAMENTARY AND LOCAL FAMILIES, AND MUST STAY SO. There a
 *  section's own page is `/section/:code` while `placeViewUrl` maps a section ref to its PARENT
 *  SETTLEMENT (`/sections/:ekatte`) — exactly the destination the section level is supposed to
 *  offer. Computing "self" through the router would refuse the one level whose leaf is real, so
 *  it returns null and the guard does not fire.
 *
 *  ⚠ PRESIDENTIAL RESOLVES BEFORE THAT EXEMPTION, because its section page and its complete
 *  result are not the same route: the page is `/presidential/:cycle/section/:code` and the
 *  producer offers the parent SETTLEMENT as the fuller result. The guard therefore has real
 *  work to do at every one of that family's levels — it refuses the four place levels, whose
 *  complete result IS the page being read, and passes the section link through.
 *
 *  ⚠ AND THE ROUTES COME FROM THE ROUTER, never from a template here — the same rule
 *  `ElectionDestination.to` states. A hand-built `/sections/${id}` would keep matching after
 *  the routing rule moved and silently stop refusing anything. */
const ownPageRoute = (
  kind: ElectionKind,
  level: ElectionPlaceLevel,
  id: string,
  cycle: string,
  localCycle?: string,
): string | null => {
  // ⚠ BEFORE THE `section` EXEMPTION — see the docblock. Every presidential level has a page of
  // its own, so "self" is always computable here and the exemption below would be wrong.
  if (kind === "presidential")
    return level === "country" || level === "abroad"
      ? presidentialUrl(cycle, level)
      : presidentialUrl(cycle, level, id);
  if (level === "section") return null;
  // Abroad has no `toPlaceRef` of its own (it is not a Bulgarian place), but it IS served by
  // the region route, which is the page a reader would be on.
  const ref: PlaceRef | null =
    level === "abroad"
      ? { level: "region", oblast: id }
      : toPlaceRef(level, id);
  if (!ref) return null;
  if (kind === "local") return localCycle ? localUrl(ref, localCycle) : null;
  return placeViewUrl("parliamentary", ref);
};

export const buildDestinations = (
  input: DestinationInput,
): ElectionDestinations => {
  const {
    kind,
    level,
    id,
    cycle,
    localCycle,
    inLocalCycle,
    presidentialCycle,
    completeResultTo,
    childPlacesTo,
    parentPlaceTo,
    officialProtocolTo,
  } = input;

  // ⚠ A SURFACE NEVER LINKS TO ITS OWN PAGE, and `completeResult` never had that rule while
  // `views` twenty lines down always did. Measured over the published 2026-04-19 corpus before
  // this guard: 5,396 of 18,117 artifacts (29.8%) carried a `completeResult` pointing at the
  // artifact's own route, `available: true` — every region (31), abroad (1) and settlement
  // (5,364). The section level (12,721) was the only one whose target is a different page, the
  // parent settlement, and it is the one that survives.
  //
  // It was invisible because NOTHING RENDERED THE FIELD. `destinations` has been generated,
  // schema-gated and published since Phase 1 with no consumer, so a payload nobody read could
  // not be wrong on screen — the defect surfaced the moment the leaf was about to be rendered,
  // which is Phase 7's job.
  //
  // ⚠ THE REASON IS `same_page`, NOT `no_data_for_place`. A region's complete result EXISTS and
  // is what the reader is looking at; saying the place has no such result would be false, and a
  // consumer that renders reasons would publish it.
  const selfTo = ownPageRoute(kind, level, id, cycle, localCycle);
  const completeResult: ElectionDestination =
    completeResultTo !== null && completeResultTo === selfTo
      ? { to: "", available: false, reason: "same_page" }
      : dest(completeResultTo, "no_data_for_place");

  const out: ElectionDestinations = { completeResult };
  if (childPlacesTo !== undefined)
    out.childPlaces = dest(childPlacesTo, "no_data_for_place");
  if (parentPlaceTo !== undefined)
    out.parentPlace = dest(parentPlaceTo, "no_data_for_place");
  // ⚠ THE REASON IS `no_data_for_place`, NOT `not_at_section`. This field is only ever emitted
  // AT a section, so "not at a section" is the one thing it cannot mean — the section exists and
  // its protocol scan does not.
  if (officialProtocolTo !== undefined)
    out.officialProtocol = dest(officialProtocolTo, "no_data_for_place");

  if (level === "section") return out;

  const ref = toPlaceRef(level, id);
  const views: Partial<Record<PlaceViewName, ElectionDestination>> = {};
  for (const view of VIEW_NAMES) {
    // A surface never links to its own view — that cell restates the page the reader is on
    // (§7.1), and the digest drops it. Kept out of the payload rather than filtered downstream.
    if (view === kind) continue;
    if (!ref) {
      // Abroad: there is no governance/consumption/local page for a place outside Bulgaria.
      //
      // ⚠ PRESIDENTIAL IS THE ONE EXCEPTION, AND IT IS NOT HANDLED HERE. Unlike the other
      // three, `/presidential/:cycle/abroad` genuinely exists (`PRESIDENTIAL_ABROAD_ID`) — so
      // marking it `not_abroad` at the ABROAD LEVEL (as opposed to a diaspora settlement,
      // which is a different case entirely) is imprecise. Left this way because nothing reads
      // `destinations.views` yet (see `ElectionResultsShell.tsx`'s own note) — closing it
      // properly means a dedicated branch above this one, keyed on `level === "abroad"`.
      views[view] = { to: "", available: false, reason: "not_abroad" };
      continue;
    }
    if (view === "presidential") {
      // ⚠ SAME SHAPE AS "local" BELOW: a resolvable URL is not evidence this cycle actually
      // published a surface here — `presidentialViewUrl`'s own header explains why that is
      // fine for presidential specifically (an uncovered place still renders an honest "not
      // published" page). What IS distinguished is "no cycle given" vs "declined/resolved" —
      // see `no_presidential_cycle` on `ElectionUnavailableReason`.
      const to = presidentialCycle
        ? presidentialViewUrl(ref, presidentialCycle)
        : null;
      views[view] = dest(
        to,
        presidentialCycle ? "no_data_for_place" : "no_presidential_cycle",
      );
      continue;
    }
    if (view === "local") {
      // ⚠ A RESOLVABLE URL IS NOT DATA. `localUrl` happily builds a path for any município in
      // any cycle string; whether that cycle covered this place is the caller's check, and
      // skipping it publishes links to pages that render "no results".
      const to = localCycle && inLocalCycle ? localUrl(ref, localCycle) : null;
      views[view] = dest(
        to,
        localCycle ? "no_data_for_place" : "no_local_cycle",
      );
      continue;
    }
    views[view] = dest(
      placeViewUrl(view as PlaceView, ref),
      "no_data_for_place",
    );
  }
  out.views = views;
  return out;
};
