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

/** What kind of geographic entity the user picked. Three values today:
 *  settlement (EKATTE 5-digit numeric), municipality (obshtina alphanumeric
 *  like BLG52), Sofia район (alphanumeric SOF NN sub-code). The Sofia район
 *  case is not yet emitted by the resolver in Phase 1 — placeholder for
 *  Phase 2's райони drill-in. */
export type AreaKind = "settlement" | "municipality" | "raion";

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
  // /governance/companies — the all-office-holder companies list (Tier 3 of the
  // company-page consolidation). Without this, AREA_PATH_RE reads "companies" as a place id
  // and the page anchors the whole My-Area context to a município that does not exist.
  "companies",
] as const;

export const AREA_PATH_RE = new RegExp(
  `^(?:/en)?/governance/(?!(?:${GOVERNANCE_NON_PLACE_SEGMENTS.join("|")})(?:/|$))([^/?#]+)`,
);

/** True when this path IS the place node — i.e. the anchor is path-derived and
 *  clearing `?area=` alone would not clear it. Shared with `AreaPill`'s × so the
 *  two cannot disagree about which URLs are places; before this the pill's own
 *  copy of the regex excluded `region` and nothing else. */
export const onPlaceNode = (pathname: string): boolean =>
  AREA_PATH_RE.test(pathname);
