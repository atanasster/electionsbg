// Area anchor — types, contexts, helpers + hooks. The matching
// AreaAnchorProvider lives in AreaAnchorProvider.tsx.
//
// The anchor is the user's chosen "My Area" — a settlement (EKATTE), a
// municipality (obshtina code), or a Sofia район code. It's URL-encoded as
// `?area=<id>` and mounted globally so the header pill, the MyAreaScreen,
// and any tile that wants to react to the user's chosen place can read it.
//
// Pattern mirrors cabinetAnchor.ts exactly — keep them in sync if the
// contract evolves.
//
// The provider does NOT resolve the area to a full record; it just exposes
// the raw `id` so the resolution (settlement/municipality/Sofia район +
// name + oblast + MIR) happens at the call site via useAreaResolver. That
// keeps this file dependency-light and lets the resolver evolve without
// re-rendering every consumer.
import { createContext, useContext } from "react";

export const AREA_ANCHOR_PARAM = "area";

export type AreaAnchor = {
  /** Raw id from the URL. */
  id: string;
};

export const AreaAnchorContext = createContext<AreaAnchor | null>(null);
export const AreaAnchorSetterContext = createContext<
  ((id: string | null) => void) | null
>(null);

/** Read the active area anchor (or null when no `?area=` is set). */
export const useAreaAnchor = (): AreaAnchor | null =>
  useContext(AreaAnchorContext);

/** Setter for the anchor URL param. Returns a no-op when called outside an
 *  AreaAnchorProvider so call sites don't need to null-check. */
export const useSetAreaAnchor = (): ((id: string | null) => void) => {
  const setter = useContext(AreaAnchorSetterContext);
  return setter ?? (() => undefined);
};

/** Static `/governance/<segment>` pages that are NOT personal place anchors.
 *
 *  Every page added under `/governance/` competes with the `:id` place node for
 *  this regex, and losing is silent: the header pill pins the path segment as
 *  though it were a place, `?area=` starts travelling with it, and the reader
 *  carries a bogus anchor around the site. `municipal-finance` shipped that way
 *  for exactly as long as it took to look at the header.
 *
 *  `governanceNonPlace.test.ts` (beside this file) derives the expected set from `routes.tsx`,
 *  so a new static page cannot be added without joining this list. */
export const GOVERNANCE_NON_PLACE_SEGMENTS = [
  "region",
  "sectors",
  "overview",
  "declarations",
  "municipal-finance",
  // /governance/companies — RETIRED as a real page (188) but still a React route rendering a
  // client-side redirect to /companies?political=1, so this stays. Without it, AREA_PATH_RE
  // reads "companies" as a place id and the page anchors the whole My-Area context to a
  // município that does not exist.
  "companies",
  // /governance/mayor-pay — a ranked chart + table of mayoral pay across ~259 municipalities
  // (added 2026-08-25). Without it AREA_PATH_RE reads "mayor-pay" as a place id: the resolver
  // returns kind:"unknown", so the pill falls back to the raw segment as its display name, a
  // reader's real `?area=` is MASKED for as long as they are on the page (path wins over
  // query), and the pill's × sees onPlaceNode() === true and navigates them away to /my-area.
  "mayor-pay",
] as const;

/** Make a segment literal when spliced into the pattern below. Every entry is
 *  `[a-z-]+` today, so this changes nothing — but a future route segment carrying
 *  `.`, `+` or `(` would otherwise alter the pattern's MEANING rather than being
 *  matched, and the symptom would be the same silent one this list prevents. */
const escapeRe = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const AREA_PATH_RE = new RegExp(
  // The lookahead's boundary must match the capture group's own exclusion set
  // (`[^/?#]`). With a bare `(?:/|$)` a pathname carrying `?` or `#` slips past
  // EVERY entry above — `/governance/mayor-pay?area=68134` was read as the place
  // „mayor-pay", i.e. the exact shape this list exists to protect. Not reachable
  // from today's two call sites (both pass `location.pathname`), but `onPlaceNode`
  // is exported and its signature accepts any string.
  `^(?:/en)?/governance/(?!(?:${GOVERNANCE_NON_PLACE_SEGMENTS.map(
    escapeRe,
  ).join("|")})(?:[/?#]|$))([^/?#]+)`,
);

/** True when this path IS the place node — i.e. the anchor is path-derived and
 *  clearing `?area=` alone would not clear it. Shared with `AreaPill`'s × so the
 *  two cannot disagree about which URLs are places; before this the pill's own
 *  copy of the regex excluded `region` and nothing else. */
export const onPlaceNode = (pathname: string): boolean =>
  AREA_PATH_RE.test(pathname);
