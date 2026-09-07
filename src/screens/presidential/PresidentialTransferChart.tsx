// The chart-or-table decision, once — shared by the country tile and the region one.
//
// ⚠⚠ IT EXISTS BECAUSE THE DECISION MUST NOT BE MADE TWICE. Two tiles now draw the same kind of
// matrix, and „is this too wide to trace" answered in two places is two answers the day either
// moves — a reader would get the table on the country page and an untraceable Sankey one level
// down, about the same estimate. `SANKEY_MAX_FROM_NODES` is the rule and this is its only
// consumer.
//
// ⚠ IT REUSES `VoteFlowSankey`, DELIBERATELY. A second flow chart would be a second visual
// grammar for the same claim, and the ribbons/labels/dimming policy readers already know from
// „накъде отидоха гласовете" is exactly the right one here. The producer emits `VoteFlowMatrix`
// for that reason.
//
// ⚠ NO PIN/OVERLAY. The parliamentary tile pins a node and opens a detail card; this matrix has
// at most five columns and a reader can follow a ribbon by eye, so the extra state is cost with
// no benefit. Hover tooltip only.

import { FC, useState } from "react";
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
import {
  PresidentialTransferTable,
  SANKEY_MAX_FROM_NODES,
} from "./PresidentialTransferTable";
import type { VoteFlowMatrix } from "@/data/voteFlows/voteFlowTypes";

export const PresidentialTransferChart: FC<{ matrix: VoteFlowMatrix }> = ({
  matrix,
}) => {
  const isMd = useMediaQueryMatch("md");
  const [hover, setHover] = useState<VoteFlowHover | null>(null);
  // ⚠ THE SHARED HOOK, not a fourth copy of the same callback. `VoteFlowTile` had the original
  // and the tile said so in a comment; the comment is now an import.
  const [containerRef, width] = useMeasuredWidth();
  // ⚠ THE FROM SIDE ONLY. The to side is two candidates plus three lanes on every cycle ever
  // held; what varies — and what makes the chart unreadable — is how many pairs stood in
  // round 1. Measured nationally: 8, 9, 20, 24, 26.
  const wide = matrix.fromNodes.length > SANKEY_MAX_FROM_NODES;

  // ⚠ THE TABLE NEEDS NO RESERVED HEIGHT and must not inherit the chart's. `minHeight` exists
  // so a measuring Sankey does not collapse the tile while `useMeasuredWidth` settles; applied
  // to a table it reserves 460px that a five-row 2001 matrix never fills, which is the layout
  // shift in the other direction.
  if (wide)
    return (
      <div className="mt-3 min-w-0">
        <PresidentialTransferTable matrix={matrix} />
      </div>
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
