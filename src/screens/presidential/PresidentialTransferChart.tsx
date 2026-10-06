// The runoff-transfer Sankey — shared by the country tile and the region one, so the two cannot
// draw the same kind of estimate differently.
//
// ⚠ ALWAYS A SANKEY. Wide rounds (2011, 2016, 2021: 20-26 candidates) used to fall back to a
// table of percentages; `transferSankeyMatrix` groups the candidates under 1% of round 1's
// valid votes into „Други двойки" instead — the rule the parliamentary→presidential flow chart on
// the same page already uses — and colours each candidate from `tickets.json`.
//
// ⚠ IT REUSES `VoteFlowSankey`, DELIBERATELY. A second flow chart would be a second visual
// grammar for the same claim, and the ribbons/labels/dimming policy readers already know from
// „накъде отидоха гласовете" is exactly the right one here.
//
// ⚠ NO PIN/OVERLAY. The parliamentary tile pins a node and opens a detail card; this matrix has
// a handful of columns and a reader can follow a ribbon by eye. Hover tooltip only.

import { FC, useMemo, useState } from "react";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { useMeasuredWidth } from "@/ux/useMeasuredWidth";
import {
  SANKEY_HEIGHT,
  VoteFlowSankey,
} from "@/screens/components/voteFlow/VoteFlowSankey";
import { VoteFlowMobile } from "@/screens/components/voteFlow/VoteFlowMobile";
import {
  VoteFlowTooltip,
  type VoteFlowHover,
} from "@/screens/components/voteFlow/VoteFlowTooltip";
import { useTicketsByNumber } from "@/data/presidential/useTickets";
import { transferSankeyMatrix } from "@/data/presidential/transferSankey";
import type { VoteFlowMatrix } from "@/data/voteFlows/voteFlowTypes";

/** Node labels are data, in both languages — the flow producer's own wording for the group. */
const OTHER_LABEL = { bg: "Други двойки", en: "Other pairs" };

export const PresidentialTransferChart: FC<{
  cycle: string;
  matrix: VoteFlowMatrix;
}> = ({ cycle, matrix: published }) => {
  const isMd = useMediaQueryMatch("md");
  const [hover, setHover] = useState<VoteFlowHover | null>(null);
  const [containerRef, width] = useMeasuredWidth();
  const tickets = useTicketsByNumber(cycle);
  const matrix = useMemo(
    () => transferSankeyMatrix(published, tickets, OTHER_LABEL),
    [published, tickets],
  );

  return (
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
  );
};
