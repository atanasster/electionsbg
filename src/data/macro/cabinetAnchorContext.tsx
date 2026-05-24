// Global cabinet anchor — a single selected cabinet, URL-encoded as
// `?cabinet=<id>` and surfaced via context across the governments +
// indicators route group. Used by the header pill, the per-tile "При
// [Cabinet]" footer, the cabinet-detail page, and (opt-in) the /compare
// snapshot panels.
//
// The anchor is **additive** for most consumers: KpiTile headlines,
// PeerSnapshotTable on /economy / /fiscal, etc. read the *election*-driven
// snapshot via useElectionAsOf, so the period label on each tile always
// matches the election the user picked in the header. Components that
// genuinely want to re-anchor (the /compare WGI radar, COFOG multiples,
// inequality panel, spend-outcome scatters, the /compare PeerSnapshotTable)
// opt in explicitly via useCompareSnapshotAsOf / useCompareSnapshotYear,
// which fall back from cabinet anchor → election.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type PropsWithChildren,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  useGovernments,
  type Government,
} from "@/data/governments/useGovernments";
import type { AsOf } from "./kpiSelectors";

/** Snapshot anchor consumed by useElectionAsOf and useElectionYear plus the
 *  resolved cabinet record — header pills, breadcrumbs and delta footers all
 *  read the cabinet from here rather than threading useGovernments through. */
export type CabinetAnchor = {
  /** Quarterly anchor. `null` = "use the latest available point" — for an
   *  incumbent cabinet still in office we want fresh data, not a stale
   *  tenure-end snapshot. */
  asOf: AsOf | null;
  /** Annual anchor for year-only series (WGI, COFOG, SILC, life expectancy). */
  year: number;
  /** The resolved cabinet record itself. */
  cabinet: Government;
};

export const CABINET_ANCHOR_PARAM = "cabinet";

const CabinetAnchorContext = createContext<CabinetAnchor | null>(null);
const CabinetAnchorSetterContext = createContext<
  ((id: string | null) => void) | null
>(null);

/** Compute the snapshot anchor for a cabinet's tenure. Incumbent → null asOf
 *  + current year (= latest data). Finished cabinet → end-of-tenure quarter. */
export const anchorForCabinet = (
  cabinet: Government,
): { asOf: AsOf | null; year: number } => {
  if (cabinet.endReason === "incumbent" || !cabinet.endDate) {
    return { asOf: null, year: new Date().getFullYear() };
  }
  const end = new Date(cabinet.endDate);
  const year = end.getUTCFullYear();
  const month0 = end.getUTCMonth();
  const quarter = (Math.floor(month0 / 3) + 1) as 1 | 2 | 3 | 4;
  return { asOf: { year, quarter }, year };
};

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

/** Read the active cabinet anchor (or null when no `?cabinet=` is set). */
export const useCabinetAnchor = (): CabinetAnchor | null =>
  useContext(CabinetAnchorContext);

/** Setter for the anchor URL param. Returns a no-op when called outside a
 *  CabinetAnchorProvider so call sites don't need to null-check. */
export const useSetCabinetAnchor = (): ((id: string | null) => void) => {
  const setter = useContext(CabinetAnchorSetterContext);
  return setter ?? (() => undefined);
};

/** Three-state return:
 *   - `undefined` → no anchor set; caller should fall back to election asOf
 *   - `null`      → anchor IS set but the cabinet is incumbent (= "use the
 *                   literal latest available point", a meaningful asOf
 *                   value that pickAtOrBefore interprets specifically)
 *   - `{year, quarter}` → anchored to cabinet's tenure-end quarter
 *
 *  The three-state semantic lets useCompareSnapshotAsOf distinguish "no
 *  override" from "override that means latest data" without conflating
 *  them.
 */
export type CabinetAnchorAsOf = AsOf | null | undefined;

export const useCabinetAnchorAsOf = (): CabinetAnchorAsOf => {
  const anchor = useContext(CabinetAnchorContext);
  if (!anchor) return undefined;
  return anchor.asOf;
};

/** Annual anchor — cabinet's tenure-end year when an anchor is set, else
 *  `null` (caller falls back to election year). */
export const useCabinetAnchorYear = (): number | null => {
  const anchor = useContext(CabinetAnchorContext);
  return anchor?.year ?? null;
};
