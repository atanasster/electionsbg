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
  type PlaceRef,
  type PlaceView,
} from "@/data/local/placeViews";
import type {
  ElectionDestination,
  ElectionDestinations,
  ElectionKind,
  ElectionPlaceLevel,
  ElectionUnavailableReason,
  PlaceViewName,
} from "./surfaceTypes";

/** The four views, in `PlaceViewNav`'s order — imported rather than restated would be better,
 *  but the nav's order lives in `PLACE_DIGEST_ORDER` (a browser module the generator already
 *  imports) and this is the same list; `source_links.test.ts` asserts they agree. */
export const VIEW_NAMES: readonly PlaceViewName[] = [
  "governance",
  "parliamentary",
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
export const buildDestinations = (
  input: DestinationInput,
): ElectionDestinations => {
  const {
    kind,
    level,
    id,
    localCycle,
    inLocalCycle,
    completeResultTo,
    childPlacesTo,
    parentPlaceTo,
    officialProtocolTo,
  } = input;

  const out: ElectionDestinations = {
    completeResult: dest(completeResultTo, "no_data_for_place"),
  };
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
      views[view] = { to: "", available: false, reason: "not_abroad" };
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
