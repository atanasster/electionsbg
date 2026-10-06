// The transfer tile's shell — label, caveat, chart, precision — shared by the country tile and
// the region one.
//
// ⚠⚠ THE CAVEAT IS RENDERED FROM THE DATA, NOT FROM A TRANSLATION KEY, and that is the point of
// the whole card. `basis` is the sentence saying this is an ESTIMATE — an ecological regression
// consistent with the published numbers, never counted people — and it travels inside the
// artifact so no surface can draw the chart without it. Both hooks refuse a payload that has
// lost it, so „the chart rendered" implies „the caveat rendered".
//
// ⚠ IT EXISTS BECAUSE THE SHELL HAD ALREADY DRIFTED ON DAY ONE. Extracting only the chart left
// ~55 lines of identical JSX in two files, and the copy introduced a second spelling of one
// rule immediately: `PCT_DIGITS` in the region tile against an inline `1` in the country one.
// The two tiles genuinely differ in exactly one thing — the coverage sentence, whose fields are
// not the same — so that is the only prop that is a `ReactNode`.
//
// ⚠ THE CAVEAT GOES ABOVE THE CHART. Under it, a reader who stops at the picture has read the
// claim and not the qualification.

import { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { GitFork } from "lucide-react";
import { Hint } from "@/ux/Hint";
import { StatCard } from "@/screens/dashboard/StatCard";
import { PresidentialTransferChart } from "./PresidentialTransferChart";
import { formatPct } from "@/lib/currency";
import type { VoteFlowMatrix } from "@/data/voteFlows/voteFlowTypes";

const PCT_DIGITS = 1;

/**
 * Above this, the precision line stops being a footnote.
 *
 * ⚠⚠ IT IS ABOUT THE REGION PAGES, AND THE DISTRIBUTION IS WHY. Nationally `marginGap` is
 * 0.012-0.047 — a genuine footnote. Per oblast the RAS residual no longer cancels across 31
 * oblasts, so measured over the 155 shards the median is 0.09 but **16 (10.3%) are ≥ 0.30 and
 * 8 are ≥ 0.50**, topping out at **0.70 on 2011/S23**. That page would otherwise read „the
 * ribbons miss their column labels by up to 70%" in the same 12px grey as the country page's
 * 2.8% — at which point the sentence has stopped qualifying the chart and started replacing it.
 */
export const MARGIN_GAP_LOUD = 0.3;

export const PresidentialTransferCard: FC<{
  cycle: string;
  basis: string;
  basisEn: string;
  matrix: VoteFlowMatrix;
  marginGap: number;
  /** The coverage paragraph — the one thing the two callers genuinely differ on, because the
   *  cycle file and a shard declare different fields. */
  coverage: ReactNode;
}> = ({ cycle, basis, basisEn, matrix, marginGap, coverage }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const loud = marginGap >= MARGIN_GAP_LOUD;

  return (
    <StatCard
      label={
        <Hint text={t("presidential_transfer_hint")} underline={false}>
          <div className="flex items-center gap-2">
            <GitFork className="h-4 w-4" />
            <span>{t("presidential_transfer_title")}</span>
          </div>
        </Hint>
      }
      className="overflow-hidden"
    >
      <PresidentialTransferChart cycle={cycle} matrix={matrix} />
      {/* ⚠ ONE SHORT CAPTION UNDER THE CHART, the method behind „Как се изчислява" — the shape
          of the flow chart above it on the same page. The caveat (`basis`) is still on the page
          and one click away, not removed: it is what makes the chart an ESTIMATE. */}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        {t("presidential_transfer_caption")}
      </p>
      {/* ⚠ A LARGE GAP STAYS VISIBLE. On a region page the ribbons can miss their column labels
          by up to 70%, and that qualifies the chart rather than footnoting it. */}
      {loud ? (
        <p className="mt-2 text-xs font-medium text-foreground">
          {t("presidential_transfer_precision", {
            pct: formatPct(marginGap, lang, PCT_DIGITS),
          })}
        </p>
      ) : null}
      <details className="mt-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer">
          {t("vote_flow_tile_methodology_link")}
        </summary>
        <p className="mt-1">{lang === "en" ? basisEn : basis}</p>
        {loud ? null : (
          <p className="mt-1">
            {t("presidential_transfer_precision", {
              pct: formatPct(marginGap, lang, PCT_DIGITS),
            })}
          </p>
        )}
        <p className="mt-1">{coverage}</p>
      </details>
    </StatCard>
  );
};
