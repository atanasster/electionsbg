// A complete, fixed art direction shared by article canvas, chapter stills and share image.
// Never mix page-theme land/labels with a poster's independently chosen dark background.
import type { FlyoverPalette } from "./layers";
import type { FlyoverState } from "./state";

export const ARTICLE_BACKGROUND = "#f3eee5";
export const ARTICLE_PALETTE: FlyoverPalette = {
  land: "#dce3db",
  landEdge: "#a8b6ad",
  landHighlight: "#d4ad8c",
  column: { proc: "#467c9b", funds: "#89729f", agri: "#4d8869" },
  arcIn: "#bd6846",
  arcOut: "#368779",
  arcNeutral: "#778598",
  label: "#263d3b",
  labelHalo: ARTICLE_BACKGROUND,
  priceDown: "#69a585",
  priceUp: "#cd8267",
};

/** Frame the whole country and the tallest columns, rather than retaining tour closeups.
 * Only presentation changes: layer weights, attribution, highlights and captions stay intact.
 * Keeping the camera fixed also makes the six article layers directly comparable. */
export const articlePresentationState = (
  state: FlyoverState,
): FlyoverState => ({
  ...state,
  camera: { target: [500, 300], distance: 1120, pitch: 52, yaw: 0 },
  labels: 0.9,
});
