// WHERE a surface points, and WHICH authority stands behind it (§5 "ElectionDestinations",
// §5 "The source authority is not single-valued", §4.1).
//
// ⚠ EVERY ROUTE COMES FROM `placeViewUrl` / `localUrl`, NEVER FROM A STRING BUILT HERE. This
// is the module's whole reason to exist. A generator that concatenates `/local/${cycle}/${code}`
// keeps emitting the old shape after the routing rule moves — and both sides stay green,
// because the generator's tests assert the string it builds and the router's tests assert the
// route it serves. Nothing compares them. The helpers already encode the cases a hand-built
// path gets wrong: Sofia's city aggregate is `SOF` and never `SOF00`, a Sofia район is a
// município in the local tree and a settlement in the parliamentary one, and Пловдив/Варна
// райони have their own local pages.
//
// ⚠ `available: false` IS A RENDERED STATE, NOT AN OMISSION (§5). "Тук не са провеждани местни
// избори през 2023" is an answer; a silently missing pill is not. So a view that does not
// resolve carries a `reason` enum key both locales carry, and the caller renders it.
//
// ⚠ ABSENT `reconciliation` MEANS NOT RECONCILED, NEVER "THEY AGREE" — the same rule as
// `turnoutBasis: "unavailable"`. Only the local tier has a second authority at all, so the
// field is absent on every parliamentary surface by construction, and a UI that renders
// "confirmed" from its absence is the defect the shape exists to prevent.

import fs from "node:fs";
import path from "node:path";
import { computeOverall } from "../parsers_local/reconcile_officials";
// ⚠ THE PUBLISHED TYPES, not the parser's private ones. `Parameters<typeof computeOverall>`
// bound this reader to whatever shape the parser happened to have; the file on disk is
// published under these, and the two are separate declarations that can drift.
import type {
  MayorDiffStatus,
  MunicipalityOfficialsDiff,
} from "../../src/data/local/types";
import {
  localUrl,
  placeViewUrl,
  type PlaceLevel,
  type PlaceRef,
  type PlaceView,
} from "../../src/data/local/placeViews";
import type {
  ElectionDestination,
  ElectionDestinations,
  ElectionKind,
  ElectionPlaceLevel,
  ElectionUnavailableReason,
  PlaceViewName,
} from "../../src/data/elections/surfaceTypes";

export const DATA_ROOT = path.join(process.cwd(), "data");

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

// ─── the second authority (§5) ──────────────────────────────────────────────────────────────

/** The `/sverka` sidecar for one município in one local cycle, if the cycle ships one. */
export const sverkaSidecarPath = (cycle: string, obshtina: string): string =>
  path.join(DATA_ROOT, cycle, "officials_diff", `${obshtina}.json`);

export type Reconciliation = {
  against: "officials_roster";
  /** ⚠ FOUR STATES, NEVER A BOOLEAN. See `surfaceTypes.ts` — `missing` is the roster being
   *  SILENT about a mayor, and collapsing it into "does not agree" publishes a contradiction
   *  that six municipalities' sidecars do not assert. */
  outcome: MunicipalityOfficialsDiff["overallStatus"];
  to: string;
};

/** ⚠ `agrees` IS RE-DERIVED FROM THE SIDECAR'S PARTS, never copied from its stored
 *  `overallStatus`. §5's gate says so: "`agrees` re-derives from the sidecar rather than from a
 *  stored copy" — a surface that trusts the scalar inherits whatever the comparison meant when
 *  it was last written.
 *
 *  ⚠ THE OUTCOME IS CARRIED WHOLE, NEVER REDUCED TO A BOOLEAN. `computeOverall(...) === "match"`
 *  was the first shape and it fabricated a contradiction for the six municipalities whose
 *  roster has no mayor record at all.
 *
 *  ⚠ RE-DERIVE THROUGH `computeOverall`, NEVER THROUGH A RULE RESTATED HERE. That is the whole
 *  difference between re-deriving and inventing a second, harsher test. The first draft of this
 *  function required a 100% council match; the real rule is 80% (`reconcile_officials.ts`), and
 *  the strict version marked 195 of 288 municipalities as contradicted — every one of them with
 *  a mayor whose name matches EXACTLY on both sides — which is a fabricated accusation against
 *  named councils, published from a file whose own summary says "match".
 *
 *  Returns `undefined` — meaning NOT RECONCILED — when no sidecar exists. Never `agrees: true`. */
export const readReconciliation = (
  cycle: string,
  obshtina: string,
): Reconciliation | undefined => {
  const p = sverkaSidecarPath(cycle, obshtina);
  if (!fs.existsSync(p)) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    // A malformed sidecar is NOT agreement, and it is not silence either — but the surface has
    // one boolean to say it with, so the honest answer is "not reconciled".
    return undefined;
  }
  const d = raw as {
    mayor?: { status?: MayorDiffStatus };
    council?: MunicipalityOfficialsDiff["council"];
  };
  // A sidecar missing either part cannot be re-derived, and "cannot check" is not agreement.
  if (!d.mayor?.status || !d.council) return undefined;
  return {
    against: "officials_roster",
    outcome: computeOverall(d.mayor.status, d.council),
    // `/sverka` is a routed page; the route is a constant of the app, not a built path.
    to: "/sverka",
  };
};

/** Does this cycle ship the comparison at all? §5's gate: `reconciliation` is present iff a
 *  sidecar exists for that município in that cycle. */
export const hasSverkaSidecar = (cycle: string, obshtina: string): boolean =>
  fs.existsSync(sverkaSidecarPath(cycle, obshtina));

/** The `PlaceLevel` a router helper understands, for a caller that has an election level. */
export const routerLevel = (level: ElectionPlaceLevel): PlaceLevel | null =>
  level === "abroad" ? null : level;
