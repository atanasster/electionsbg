// Global area anchor provider — mounts once at the app root so the chosen
// "My Area" (settlement / município / Sofia район) is visible to every
// route. URL-encoded as `?area=<id>`.
//
// The header pill + sniper button read from it; MyAreaScreen reads from it
// when no `:id` is in the path; future tiles can opt in to react to the
// user's chosen place without prop-drilling.
//
// Pattern mirrors CabinetAnchorProvider — see cabinetAnchorContext.tsx.

import { useCallback, useMemo, type PropsWithChildren } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AREA_ANCHOR_PARAM,
  AreaAnchorContext,
  AreaAnchorSetterContext,
  type AreaAnchor,
} from "./areaAnchor";

export const AreaAnchorProvider = ({ children }: PropsWithChildren) => {
  const [params, setParams] = useSearchParams();
  const id = params.get(AREA_ANCHOR_PARAM);

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
