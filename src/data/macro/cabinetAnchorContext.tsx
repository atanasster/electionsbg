// Global cabinet anchor provider — a single selected cabinet, URL-encoded as
// `?cabinet=<id>` and surfaced via context across the governments + indicators
// route group. Used by the header pill, the per-tile "При [Cabinet]" footer,
// the cabinet-detail page, and (opt-in) the /compare snapshot panels.
//
// The hooks, types, helper, and context objects live in cabinetAnchor.ts so
// this file can stay component-only (fast-refresh).

import { useCallback, useMemo, type PropsWithChildren } from "react";
import { useSearchParams } from "react-router-dom";
import { useGovernments } from "@/data/governments/useGovernments";
import {
  CABINET_ANCHOR_PARAM,
  CabinetAnchorContext,
  CabinetAnchorSetterContext,
  anchorForCabinet,
  type CabinetAnchor,
} from "./cabinetAnchor";

export const CabinetAnchorProvider = ({ children }: PropsWithChildren) => {
  const [params, setParams] = useSearchParams();
  const slug = params.get(CABINET_ANCHOR_PARAM);
  const { data: governments } = useGovernments();

  const value = useMemo<CabinetAnchor | null>(() => {
    if (!slug || !governments) return null;
    const cabinet = governments.find((g) => g.id === slug);
    if (!cabinet) return null;
    const { asOf, year } = anchorForCabinet(cabinet);
    return { asOf, year, cabinet };
  }, [slug, governments]);

  const setAnchor = useCallback(
    (next: string | null) => {
      // Read params fresh inside the setter so two rapid calls from different
      // components don't clobber each other's pending updates.
      setParams(
        (prev) => {
          const updated = new URLSearchParams(prev);
          if (next) {
            updated.set(CABINET_ANCHOR_PARAM, next);
          } else {
            updated.delete(CABINET_ANCHOR_PARAM);
          }
          return updated;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return (
    <CabinetAnchorContext.Provider value={value}>
      <CabinetAnchorSetterContext.Provider value={setAnchor}>
        {children}
      </CabinetAnchorSetterContext.Provider>
    </CabinetAnchorContext.Provider>
  );
};
