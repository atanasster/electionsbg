import { FC, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { usePollsAccuracy } from "@/data/polls/usePolls";
import { useElectionContext } from "@/data/ElectionContext";
import { usePreserveParams } from "@/ux/usePreserveParams";
import { localDate } from "@/data/utils";
import {
  AccuracyTrendsBars,
  type AccuracyTrendRow,
} from "./AccuracyTrendsBars";

/**
 * Per-election polling-accuracy chart for the PARLIAMENTARY corpus — shared between the
 * dashboard tile (`AccuracyTrendsTile`) and the `/polls` accuracy page. Self-fetches the
 * accuracy series; clicking a bar (or an anomaly row) re-anchors the selected election. The
 * drawing itself is `AccuracyTrendsBars`, which the presidential trend tile also uses.
 */
export const AccuracyTrendsChart: FC<{ height?: number }> = ({ height }) => {
  const navigate = useNavigate();
  const preserveParams = usePreserveParams();
  const { data: accuracy } = usePollsAccuracy();
  const { selected } = useElectionContext();
  const selectedIso = selected?.replace(/_/g, "-");

  const goToElection = useCallback(
    (iso: string) => {
      const electionParam = iso.replace(/-/g, "_");
      const params = preserveParams({ elections: electionParam });
      navigate(`/polls?${params.toString()}`);
    },
    [navigate, preserveParams],
  );

  const rows = useMemo<AccuracyTrendRow[]>(() => {
    if (!accuracy) return [];
    return accuracy.elections
      .filter((e) => e.agencies.length > 0)
      .map((e) => {
        const maes = e.agencies.map((a) => a.mae);
        const avg = maes.reduce((a, b) => a + b, 0) / maes.length;
        const max = Math.max(...maes);
        return {
          date: e.electionDate,
          label: localDate(e.electionDate.replace(/-/g, "_")),
          avgMae: avg,
          maxMae: max,
          agencyCount: e.agencies.length,
          isSelected: e.electionDate === selectedIso,
        };
      })
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [accuracy, selectedIso]);

  return (
    <AccuracyTrendsBars rows={rows} onSelect={goToElection} height={height} />
  );
};
