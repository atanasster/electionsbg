// What a reader did with a result surface (§Phase 7 item 1).
//
// ⚠ THE EXISTING SEAM, AND NO VENDOR. `src/lib/analytics.ts` already wraps `window.gtag` and
// no-ops when it is absent, which is the seam the plan says to use "if present at implementation
// time". It is present. Nothing new is added, and nothing here loads.
//
// ⚠⚠ A PERSON'S NAME NEVER LEAVES THE PAGE, AND THE TYPE IS WHAT GUARANTEES IT. These surfaces
// carry Bulgarian personal names by design — §5.3 keeps a mayor's and a candidate's name
// untransliterated in both languages precisely so a reader can match it against a ballot — and
// `PlaceDigestLocalCell.mayorName` and `ElectionRankedEntry.candidateName` sit one property away
// from every call site here. Rendering a name to the reader who asked for the page and shipping
// it to Google are different acts, and only the first is something this project decided to do.
//
// So the payload has NO free-text field. Every parameter below is an enum member, a place code,
// a canonical party id or a count — things already public in the URL and the artifact. A future
// `detail?: string` would make the leak a one-line edit, which is why there isn't one and why
// `electionSurfaceAnalytics.test.ts` fails if a new key escapes the allowlist.

import { trackEvent } from "@/lib/analytics";
import type {
  ElectionKind,
  ElectionPlaceLevel,
  PlaceViewName,
} from "@/data/elections/surfaceTypes";

/** WHICH affordance was used. One event name with a `target`, not five event names: the
 *  question these answer is "which way out of a result surface do readers take", and that is a
 *  comparison across targets rather than five unrelated counters. */
export type SurfaceLinkTarget =
  | "digest"
  | "standout_evidence"
  | "complete_result"
  // A ranked row's own party page. ⚠ THE TARGET, NEVER THE PARTY: the id would be a name-ish
  // field on an event whose whole allowlist is codes, and „which way out of a result surface do
  // readers take" is answered by the affordance rather than by which row was clicked.
  | "ranked_entry"
  | "finder";

export const SURFACE_EVENT = "election_surface_link";

/** The complete set of parameter keys. Exported so the gate reads it rather than restating it —
 *  and so a reviewer can see at a glance that none of them can hold a name. */
export const SURFACE_EVENT_KEYS = [
  "target",
  "kind",
  "level",
  "place_id",
  "view",
  "signal",
] as const;

export type SurfaceLinkEvent = {
  target: SurfaceLinkTarget;
  kind: ElectionKind;
  level: ElectionPlaceLevel;
  /** The place code already in the URL — `BGS`, `55155`, `010100001`. Never a label. */
  placeId: string;
  /** Digest only: which of the four views the cell pointed at. */
  view?: PlaceViewName;
  /** Standout only: the signal's enum member, never its rendered sentence. */
  signal?: string;
};

export const trackSurfaceLink = (e: SurfaceLinkEvent): void => {
  trackEvent(SURFACE_EVENT, {
    target: e.target,
    kind: e.kind,
    level: e.level,
    place_id: e.placeId,
    ...(e.view ? { view: e.view } : {}),
    ...(e.signal ? { signal: e.signal } : {}),
  });
};
