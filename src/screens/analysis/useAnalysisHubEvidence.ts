// The rail wiring, shared by /parliamentary/analysis and /parliamentary/reports.
//
// ⚠️ WHY A HOOK AND NOT TWO COPIES: the wiring carries three decisions — the counts mapping,
// the row LABEL key, and which page the rows link to — and it was 17 byte-identical lines in
// each screen, gated by nothing. `analysisHubFigures.ts`'s own header argues that one module
// serves both hubs because „two copies would be two ways to caption it"; two copies of the
// code choosing the caption is the same defect one level up. Switching one screen to
// `risk_band_${b}_caption` would have left every clause green and the two hubs captioning one
// distribution differently.
//
// The PURE builder stays in `analysisHubFigures.ts` — `hubHead.gates.test.ts` calls it
// directly and must not mount React.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { HubEvidence } from "@/ux/infographic/HubHead";
import { useRiskScoreSummary } from "@/data/riskScore/useRiskScore";
import { analysisHubEvidence } from "./analysisHubFigures";

export const useAnalysisHubEvidence = (
  /** This hub's own risk page — /risk-analysis or /risk-score. See `BandStat`. */
  to: string | undefined,
  formatInt: (n: number) => string,
  /** Whether the band actually rendered its `risk` cell.
   *
   *  ⚠️ THE RAIL'S BASIS POINTS AT THAT CELL („критичната лента се показва отделно"), and the
   *  two are INDEPENDENT fetches — analysis_stats.json and risk_score_summary.json — with no
   *  ordering guarantee. If the summary lands first the aside would render its cross-reference
   *  beside a head with no band at all. The two sources cannot disagree on the NUMBERS (the
   *  aggregator derives `risk` from this very summary), so this guards the load race only. */
  hasRiskCell: boolean,
): HubEvidence | undefined => {
  const { t } = useTranslation();
  const summary = useRiskScoreSummary().data;
  return useMemo(
    () =>
      hasRiskCell
        ? analysisHubEvidence(
            summary
              ? { ...summary.counts, totalSections: summary.totalSections }
              : undefined,
            formatInt,
            (b) => t(`risk_band_${b}`),
            to,
            t,
          )
        : undefined,
    [summary, formatInt, to, t, hasRiskCell],
  );
};
