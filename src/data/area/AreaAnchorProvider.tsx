// Global area anchor provider — mounts once at the app root so the chosen
// "My Area" (settlement / município / Sofia район) is visible to every
// route.
//
// Anchor source-of-truth, in order:
//   1. URL path `/governance/<id>`      — authoritative when on the place node
//   2. URL query `?area=<id>`           — global persistence on any other route
//
// Path takes precedence on /governance/<id> so the URL stays clean (no
// duplicate `id` in path + query). On any other route we read only
// `?area=`, which is set by the sniper-icon popover when the user picks
// a place from somewhere else. The country (/governance) and region
// (/governance/region/<oblast>) nodes are NOT personal anchors, so the
// regex deliberately skips them.
//
// setAnchor(null) ONLY clears `?area=`. The path-derived anchor is
// implicit in the route — to clear that, the caller must navigate away.
// AreaPill's × handler does both: setAnchor(null) + navigate('/my-area')
// when on /governance/<id>.
//
// Pattern mirrors CabinetAnchorProvider — see cabinetAnchorContext.tsx,
// but extended with the path fallback because /governance/:id is itself an
// anchor expression while /governments has no analogous path-encoded
// cabinet.

import { useCallback, useMemo, type PropsWithChildren } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import {
  AREA_ANCHOR_PARAM,
  AreaAnchorContext,
  AreaAnchorSetterContext,
  type AreaAnchor,
} from "./areaAnchor";

// Extract `<id>` from a `/governance/<id>` pathname. Matches both
// `/governance/` and `/en/governance/` (the English-locale prefix) so the
// anchor survives language switches. The `region/` segment is excluded via a
// negative lookahead — the oblast node is not a personal anchor; the bare
// `/governance` country node has no trailing segment and so never matches.
const AREA_PATH_RE = /^(?:\/en)?\/governance\/(?!region(?:\/|$))([^/?#]+)/;

const extractPathId = (pathname: string): string | null => {
  const m = AREA_PATH_RE.exec(pathname);
  return m ? decodeURIComponent(m[1]) : null;
};

export const AreaAnchorProvider = ({ children }: PropsWithChildren) => {
  const [params, setParams] = useSearchParams();
  const location = useLocation();

  const pathId = extractPathId(location.pathname);
  const queryId = params.get(AREA_ANCHOR_PARAM);

  // Path wins over query — see the file-level comment for the rationale.
  // This is what stops `/governance/58606?area=58606` from being a thing.
  const id = pathId ?? queryId;

  const value = useMemo<AreaAnchor | null>(() => {
    if (!id) return null;
    return { id };
  }, [id]);

  const setAnchor = useCallback(
    (next: string | null) => {
      setParams(
        (prev) => {
          const updated = new URLSearchParams(prev);
          if (next) {
            updated.set(AREA_ANCHOR_PARAM, next);
          } else {
            updated.delete(AREA_ANCHOR_PARAM);
          }
          return updated;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return (
    <AreaAnchorContext.Provider value={value}>
      <AreaAnchorSetterContext.Provider value={setAnchor}>
        {children}
      </AreaAnchorSetterContext.Provider>
    </AreaAnchorContext.Provider>
  );
};
