// What a result page shows while its surface resolves (Phase 2 item 5).
//
// ⚠ IT IS NOT DECORATION — it is what stops the page moving under the reader. The canvas lands
// as a ranked list beside a map, and without a placeholder of the same shape the whole page
// jumps when the fetch returns. So the grid and both slot placements come from
// `electionSurfaceLayout.ts`, which the real canvas reads too: a hand-copied grid here is
// correct on the day it is written and drifts the first time a column ratio moves.
//
// ⚠ AND THE SWAP MUST NOT BE SILENT. `ElectionSurfaceBoundary` wraps this in `aria-busy` +
// `aria-live` — the pair the repo already uses; item 5 says explicitly not to invent a third
// pattern — so a screen reader is told the region is resolving rather than reading a stale
// legacy body and then, without a word, a different one.

import { FC } from "react";
import { MAX_BALLOT_PREVIEW } from "@/data/elections/surfaceTypes";
import {
  CANVAS_GRID_CLASS,
  CANVAS_MAP_SLOT_CLASS,
  CANVAS_RANKED_SLOT_CLASS,
  SKELETON_MAP_HEIGHT_CLASS,
  SKELETON_ROW_HEIGHT_CLASS,
} from "./electionSurfaceLayout";

const Bar: FC<{ className?: string }> = ({ className }) => (
  <div className={`animate-pulse rounded bg-muted ${className ?? ""}`} />
);

export type ElectionSurfaceSkeletonProps = {
  /** Whether the level's canvas draws a map at all. ⚠ A section draws none, so reserving a
   *  320px box there is a hole in the page that the arriving content never fills — the same
   *  layout shift, in the other direction. */
  withMap?: boolean;
  /** How many facts this level shows, so the strip does not grow or shrink on arrival. */
  facts?: number;
  /** How many ranked rows to reserve. Defaults to the producer's own preview cap. */
  rows?: number;
  /** How many CANVASES this level draws — one per ballot.
   *
   *  ⚠ A LEVEL WITH TWO BALLOTS RESERVED ONE AND SHIFTED BY A WHOLE CANVAS. `local/municipality`
   *  carries a mayor ballot and a council ballot on all 578 published surfaces, and the skeleton
   *  drew a single grid, so the arriving page pushed everything below it down by an entire
   *  ranked table. Reserving facts precisely while under-reserving the largest region on the
   *  page is the shape that makes a skeleton look like it is working. */
  canvases?: number;
};

export const ElectionSurfaceSkeleton: FC<ElectionSurfaceSkeletonProps> = ({
  withMap = true,
  canvases = 1,
  facts = 4,
  rows = MAX_BALLOT_PREVIEW,
}) => (
  // ⚠ NO LANDMARK AND NO HEADING. The boundary's wrapper already carries the label and the live
  // region; a second named region here would announce a section that does not exist yet, and
  // then vanish.
  <div data-surface-skeleton aria-hidden="true">
    <div
      className="my-4 grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
      data-skeleton-region="facts"
    >
      {Array.from({ length: facts }, (_, i) => (
        <div key={i} className="rounded-lg border bg-card p-3">
          <Bar className="h-3 w-2/3" />
          <Bar className="mt-2 h-7 w-1/2" />
        </div>
      ))}
    </div>
    {Array.from({ length: canvases }, (_, c) => (
      <div
        key={c}
        className={`my-4 ${CANVAS_GRID_CLASS}`}
        data-skeleton-region="canvas"
      >
        {/* Same DOM order as the canvas: ranked first, placed into column 2 at `lg`. */}
        <div className={CANVAS_RANKED_SLOT_CLASS} data-skeleton-slot="ranked">
          {Array.from({ length: rows }, (_, i) => (
            <Bar
              key={i}
              className={`mb-2 w-full ${SKELETON_ROW_HEIGHT_CLASS}`}
            />
          ))}
        </div>
        {withMap ? (
          <div className={CANVAS_MAP_SLOT_CLASS} data-skeleton-slot="map">
            <Bar className={`w-full ${SKELETON_MAP_HEIGHT_CLASS}`} />
          </div>
        ) : null}
      </div>
    ))}
  </div>
);
