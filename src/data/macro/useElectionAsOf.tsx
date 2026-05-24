// Translate the selected election (e.g. "2021_11_14") into a year + quarter
// snapshot that macro selectors can compare against. Used by KpiTile and the
// PeerSnapshot* components so the /indicators dashboard renders as of the
// election the user is looking at, not the latest available data.
//
// Sibling to `screens/components/euCompare/useElectionYear.ts` — that one is
// year-only (sufficient for annual COFOG / WGI / SILC series); this one keeps
// quarter resolution because the KPI series are mostly quarterly.
//
// Pure election-driven on purpose. Earlier versions of this hook also
// consulted the cabinet anchor (useCompareAnchorOverride) so /compare panels
// would re-anchor to the cabinet's tenure end. That coupling leaked the
// override into every other consumer (KpiTile headlines, PeerSnapshotTable
// on /economy and /fiscal), making the tile period label disagree with the
// selected election. Now the cabinet anchor is additive only — readers that
// genuinely want the anchored snapshot opt in via useCabinetAnchorAsOf().

import { useMemo } from "react";
import { useElectionContext } from "@/data/ElectionContext";
import {
  useCabinetAnchorAsOf,
  type CabinetAnchorAsOf,
} from "./cabinetAnchorContext";
import type { AsOf } from "./kpiSelectors";

export type ElectionAsOf = AsOf;

export const useElectionAsOf = (): ElectionAsOf | null => {
  const { selected } = useElectionContext();
  return useMemo(() => {
    if (!selected) return null;
    const m = /^(\d{4})_(\d{2})_(\d{2})$/.exec(selected);
    if (!m) return null;
    const year = Number(m[1]);
    const month0 = Number(m[2]) - 1;
    const quarter = (Math.floor(month0 / 3) + 1) as 1 | 2 | 3 | 4;
    return { year, quarter };
  }, [selected]);
};

/** Compare-screen quarterly snapshot anchor. Returns the cabinet's
 *  tenure-end asOf when an anchor is set, else the election asOf. Use on
 *  /compare panels that should re-anchor to the picked cabinet's tenure end
 *  (PeerSnapshotTable etc.). Other consumers — KpiTile headlines, snapshot
 *  panels on /economy / /fiscal — keep using useElectionAsOf so their
 *  reading matches the election the user picked in the header. */
export const useCompareSnapshotAsOf = (): AsOf | null => {
  const anchorAsOf: CabinetAnchorAsOf = useCabinetAnchorAsOf();
  const electionAsOf = useElectionAsOf();
  // The anchor explicitly encodes "incumbent" as asOf=null + year=current,
  // which means "use the latest available point". Preserve that semantic —
  // returning null from this hook causes pickAtOrBefore to short-circuit to
  // the literal tail of the series, which is what we want for the still-in-
  // office case.
  if (anchorAsOf !== undefined) return anchorAsOf;
  return electionAsOf;
};
