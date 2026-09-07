// „Money arcs" — the 30-second loop over the buyer→contractor flows.
//
// ⚠️ THE COVERAGE SENTENCE IS THE FIRST CAPTION, AND THAT IS CONTENT RATHER THAN A DISCLAIMER
// (plan §14). €43.9bn of €94.2bn has both ends on the map; a reader who sees the arcs without
// that number is looking at under half the money and told nothing. Opening on it, and giving
// it the longest dwell in the loop, is what stops it becoming a footnote.
//
// ⚠️ AND THE SECOND KEYFRAME IS THE ATTRIBUTION, not a named flow. €9.8bn of that placed
// money belongs to consortia with no seat, put at their largest member — 546 of which have
// members in more than one oblast. Naming a specific Plovdiv→Sofia pair before saying that
// would hand the reader a precision the picture does not have.
//
// The other deliberately placeless population is visible as ONE off-map endpoint throughout
// this programme. Its euro figure comes from `coverage.unplaced.notInTr`; no buyer is connected
// to it, because the artifact carries no defensible contractor oblast for that money.
//
// The camera stays flat-ish and turns slowly: an arc reads as a direction only if the viewer
// can see both of its ends, which a steep pitch takes away.
//
// ⚠️ THE DIAGONAL IS NOT DRAWN, so „56,5% stay in the buyer's own oblast" — the largest single
// quantity in the matrix — is a CAPTION and never a curve (`layers.ts` refuses it). The loop
// says it in words at t=10 for that reason; without that keyframe the picture would silently
// be about the 44% that crosses a border.

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
    // ⚠️ THE ATTRIBUTION, SECOND — before any named flow. €9.8bn of what these arcs draw is
    // consortium money placed at a member's oblast rather than at a seat (plan §7 step 3), and
    // a reader who has already been shown a specific pair by then has been given a precision
    // the picture does not have. `arcs_consortia` returns null on an artifact with no carriers,
    // and a null caption simply leaves the row empty rather than breaking the loop.
    {
      t: 5,
      state: {
        camera: { target: OVERVIEW, distance: 860, pitch: 32, yaw: 7 },
        captionId: "arcs_consortia",
      },
      dwell: 2,
    },
    {
      t: 10,
      state: {
        camera: { target: OVERVIEW, distance: 820, pitch: 30, yaw: 14 },
        captionId: "arcs_same",
      },
      dwell: 2,
    },
    // The largest cross-oblast cell in the matrix, named — the one concrete pair the picture
    // is drawing, rather than three shares of a whole.
    {
      t: 15,
      state: {
        camera: { target: PLOVDIV, distance: 700, pitch: 28, yaw: 18 },
        highlight: "PDV",
        captionId: "arcs_top_flow",
      },
      dwell: 2,
    },
    // Into the capital, where the placed money concentrates. ⚠️ No figure is repeated here:
    // the caption renders the live share, and every digit written into these comments has gone
    // stale once already — this one said 31.1% against a measured 23.9%.
    {
      t: 20,
      state: {
        camera: { target: SOFIA, distance: 620, pitch: 26, yaw: 24 },
        highlight: "SOF",
        captionId: "arcs_into_sofia",
      },
      dwell: 2,
    },
    // …and roughly half as much back out, which is the same picture read backwards. ⚠️ The
    // asymmetry that makes this pair worth two keyframes has HALVED: it was 4× (31.1% vs 7.3%)
    // before T3.1 and T3.3 placed 26k seats and 2,031 consortia, and is 2× now. Re-measure
    // before reordering the loop on the strength of it.
    {
      t: 25,
      state: {
        camera: { target: OVERVIEW, distance: 880, pitch: 34, yaw: 8 },
        highlight: null,
        captionId: "arcs_out_of_sofia",
      },
      dwell: 2,
    },
  ],
};
