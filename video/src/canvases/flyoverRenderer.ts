import WORLD_JSON from "../generated/flyover.json";
import { THEME } from "../theme";
import { TOP_FLOWS } from "../../../src/lib/flyover/layers";
import { render, type Ctx2D } from "../../../src/lib/flyover/render";
import type { FlyoverState } from "../../../src/lib/flyover/state";
import type { FlyoverWorld, Viewport } from "../../../src/lib/flyover/types";

const WORLD = WORLD_JSON as unknown as FlyoverWorld;
const pal = THEME.dark;

/** Hex-only palette shared by every deterministic Remotion frame. */
export const FLYOVER_VIDEO_PALETTE = {
  land: "#132038",
  landEdge: pal.rule,
  landHighlight: pal.accent,
  column: { proc: "#4ea3d8", funds: "#9b7fd4", agri: "#5fbf78" },
  arcIn: pal.accent,
  arcOut: "#5fbf78",
  arcNeutral: pal.muted,
  label: pal.text,
  labelHalo: pal.bg,
  priceDown: "#5fbf78",
  priceUp: pal.accent,
} as const;

/** Pure draw seam used by the composition and its Node recorder test. */
export const drawFlyoverFrame = (
  ctx: Ctx2D,
  state: FlyoverState,
  viewport: Viewport,
  clock: number,
): void => {
  render(ctx, WORLD, state, {
    viewport,
    palette: FLYOVER_VIDEO_PALETTE,
    clock,
    lang: "bg",
    maxFlows: TOP_FLOWS,
  });
};
