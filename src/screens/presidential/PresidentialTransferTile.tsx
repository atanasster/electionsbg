// „Откъде дойдоха гласовете на балотажа" — the estimated round-1 → runoff transition matrix.
//
// ⚠⚠ THE CAVEAT IS RENDERED FROM THE DATA, NOT FROM A TRANSLATION KEY, and that is the point
// of the whole tile. `transfer.basis` is the sentence saying this is an ESTIMATE — an
// ecological regression consistent with the published numbers, never counted people — and it
// travels inside the artifact so no surface can draw the Sankey without it. `useRunoffTransfer`
// refuses a payload that has lost it, so „the chart rendered" implies „the caveat rendered".
//
// ⚠ IT REUSES `VoteFlowSankey`, DELIBERATELY. A second flow chart would be a second visual
// grammar for the same claim, and the ribbons/labels/dimming policy readers already know from
// „накъде отидоха гласовете" is exactly the right one here. The producer emits
// `VoteFlowMatrix` for that reason.
//
// ⚠ NO PIN/OVERLAY. The parliamentary tile pins a node and opens a detail card; this matrix
// has at most five columns and a reader can follow a ribbon by eye, so the extra state is cost
// with no benefit. Hover tooltip only.
//
// ⚠ THE NODE TOTALS AND THE RIBBONS DO NOT ADD UP EXACTLY, and the tile says by how much.
// `marginGap` is the estimate's own imprecision — RAS converges geometrically and a nearly
// degenerate oblast does not get there — so a reader who adds the ribbons into „Радев" and
// finds a different number than the node's label has been told why in advance.

import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitFork } from "lucide-react";
import { Hint } from "@/ux/Hint";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { useMeasuredWidth } from "@/ux/useMeasuredWidth";
import { StatCard } from "@/screens/dashboard/StatCard";
import {
  SANKEY_HEIGHT,
  VoteFlowSankey,
} from "@/screens/components/voteFlow/VoteFlowSankey";
import { VoteFlowMobile } from "@/screens/components/voteFlow/VoteFlowMobile";
import {
  VoteFlowTooltip,
  type VoteFlowHover,
} from "@/screens/components/voteFlow/VoteFlowTooltip";
import { formatInt, formatPct } from "@/lib/currency";
import type { RunoffTransfer } from "@/data/presidential/useRunoffTransfer";

export const PresidentialTransferTile: FC<{ transfer: RunoffTransfer }> = ({
  transfer,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const isEn = lang === "en";
  const isMd = useMediaQueryMatch("md");
  const [hover, setHover] = useState<VoteFlowHover | null>(null);
  // ⚠ THE SHARED HOOK, not a fourth copy of the same callback. `VoteFlowTile` had the original
  // and this file said so in a comment; the comment is now an import.
  const [containerRef, width] = useMeasuredWidth();

  const { matrix, marginGap } = transfer.national;
  const cov = transfer.coverage;

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
      {/* ⚠ THE CAVEAT FIRST, ABOVE THE CHART. Under it, a reader who stops at the picture has
          read the claim and not the qualification. */}
      <p className="text-xs text-muted-foreground">
        {isEn ? transfer.basisEn : transfer.basis}
      </p>
      <div
        ref={containerRef}
        className="relative mt-3 min-w-0"
        style={{ minHeight: SANKEY_HEIGHT }}
      >
        {isMd ? (
          <>
            <VoteFlowSankey
              matrix={matrix}
              width={Math.max(0, width)}
              height={SANKEY_HEIGHT}
              hoveredId={hover?.kind === "node" ? hover.id : null}
              onHover={setHover}
            />
            <VoteFlowTooltip matrix={matrix} hover={hover} />
          </>
        ) : (
          <VoteFlowMobile matrix={matrix} />
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {t("presidential_transfer_precision", {
          pct: formatPct(marginGap, lang, 1),
        })}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {isEn ? cov.basisEn : cov.basis}{" "}
        {t("presidential_transfer_coverage", {
          sections: formatInt(cov.domesticSections, lang),
          abroad: formatInt(cov.abroadVotes, lang),
        })}
        {/* ⚠ SUPPRESSED AT ZERO, NOT PRINTED AS „0 REFUSED". Four of the five cycles refuse
            nothing; 2011 refuses 1,355 sections and 422,726 votes — nine times the abroad
            figure — and without this clause the Sankey's node labels are 276k below the
            result the same page prints, with nothing to explain the gap. */}
        {cov.unplacedSections > 0 ? (
          <>
            {" "}
            {t("presidential_transfer_coverage_unplaced", {
              sections: formatInt(cov.unplacedSections, lang),
              votes: formatInt(cov.unplacedVotes, lang),
            })}
          </>
        ) : null}
      </p>
    </StatCard>
  );
};
