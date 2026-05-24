// Translate the selected election (e.g. "2021_11_14") into a year + quarter
// snapshot that macro selectors can compare against. Used by KpiTile and the
// PeerSnapshot* components so the /indicators dashboard renders as of the
// election the user is looking at, not the latest available data.
//
// Sibling to `screens/components/euCompare/useElectionYear.ts` — that one is
// year-only (sufficient for annual COFOG / WGI / SILC series); this one keeps
// quarter resolution because the KPI series are mostly quarterly.

import { useMemo } from "react";
import { useElectionContext } from "@/data/ElectionContext";
import type { AsOf } from "./kpiSelectors";
import { useCompareAnchorOverride } from "./cabinetAnchorContext";

export type ElectionAsOf = AsOf;

export const useElectionAsOf = (): ElectionAsOf | null => {
  const { selected } = useElectionContext();
  // CabinetAnchorProvider (mounted on /governments and /indicators routes)
  // re-anchors every panel to the URL-selected cabinet's tenure. Pages
  // outside that provider get null → election behavior preserved.
  const override = useCompareAnchorOverride();
  return useMemo(() => {
    if (override) return override.asOf;
    if (!selected) return null;
    const m = /^(\d{4})_(\d{2})_(\d{2})$/.exec(selected);
    if (!m) return null;
    const year = Number(m[1]);
    const month0 = Number(m[2]) - 1;
    const quarter = (Math.floor(month0 / 3) + 1) as 1 | 2 | 3 | 4;
    return { year, quarter };
  }, [selected, override]);
};
