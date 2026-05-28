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
