// „Money arcs" — the 30-second loop over the buyer→contractor flows.
//
// ⚠️ THE COVERAGE SENTENCE IS THE FIRST CAPTION, AND THAT IS CONTENT RATHER THAN A DISCLAIMER
// (plan §14). €22.1bn of €94.1bn has both ends placed to an oblast; a reader who sees the arcs
// without that number is looking at a quarter of the money and told nothing. Opening on it,
// and giving it the longest dwell in the loop, is what stops it becoming a footnote.
//
// The camera stays flat-ish and turns slowly: an arc reads as a direction only if the viewer
// can see both of its ends, which a steep pitch takes away.
//
// ⚠️ THE DIAGONAL IS NOT DRAWN, so „55,7% stay in the buyer's own oblast" — the largest single
// quantity in the matrix — is a CAPTION and never a curve (`layers.ts` refuses it). The loop
// says it in words at t=7 for that reason; without that keyframe the picture would silently be
// about the 44% that crosses a border.

import type { Programme } from "./index";
import { ZERO_WEIGHTS as OFF } from "../state";
import { OVERVIEW, PLOVDIV, SOFIA } from "./anchors";

export const ARCS: Programme = {
  id: "arcs",
  duration: 30,
  keyframes: [
    {
      t: 0,
      state: {
        camera: { target: OVERVIEW, distance: 880, pitch: 34, yaw: 0 },
        weights: { ...OFF },
        arcs: 1,
        labels: 0.5,
        highlight: null,
        captionId: "arcs_coverage",
      },
      dwell: 3,
    },
    {
      t: 7,
      state: {
        camera: { target: OVERVIEW, distance: 820, pitch: 30, yaw: 14 },
        captionId: "arcs_same",
      },
      dwell: 2,
    },
    // The largest cross-oblast cell in the matrix, named — the one concrete pair the picture
    // is drawing, rather than three shares of a whole.
    {
      t: 13,
      state: {
        camera: { target: PLOVDIV, distance: 700, pitch: 28, yaw: 18 },
        highlight: "PDV",
        captionId: "arcs_top_flow",
      },
      dwell: 2,
    },
    // Into the capital: 31.1% of the placed money ends with a Sofia-city contractor.
    {
      t: 18,
      state: {
        camera: { target: SOFIA, distance: 620, pitch: 26, yaw: 24 },
        highlight: "SOF",
        captionId: "arcs_into_sofia",
      },
      dwell: 2,
    },
    // …and only 7.3% the other way, which is the same picture read backwards.
    {
      t: 24,
      state: {
        camera: { target: OVERVIEW, distance: 880, pitch: 34, yaw: 8 },
        highlight: null,
        captionId: "arcs_out_of_sofia",
      },
      dwell: 2,
    },
  ],
};
