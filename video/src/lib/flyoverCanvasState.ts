import {
  STATE_ZERO,
  blend,
  type FlyoverState,
} from "../../../src/lib/flyover/state";
import { resolveTimeline } from "./canvasTimeline";

/** Resolve accreting partial flyover states against absolute Remotion time. */
export const resolveFlyoverCanvas = (
  scenes: { canvas?: Partial<FlyoverState> }[],
  sceneDurations: number[],
  frame: number,
  fps: number,
  transitionSeconds = 0.9,
): FlyoverState =>
  resolveTimeline(
    STATE_ZERO,
    blend,
    scenes,
    sceneDurations,
    frame,
    fps,
    transitionSeconds,
  );
