// „Money columns" — the 42-second loop that cycles the three money taps.
//
// A camera that pulls in over Sofia, sweeps east along Тракия to Бургас and up the coast to
// Варна, then drifts back out; the layer changes twice, procurement → EU funds → farm
// subsidies, with the caption naming the layer, its total and its basis.
//
// ⚠️ THE THREE WINDOWS ARE NOT EQUAL, AND THE SPLIT IS A DECISION. Measured caption airtime
// over the loop (`programmes.test.ts` pins it): procurement ~17.5 s, EU funds ~15 s, farm
// subsidies ~9.5 s. Procurement opens the loop AND is what the closing segment eases back to,
// so it necessarily gets more; agri gets least because it is last before the wrap. An earlier
// draft was 20.1 / 14.0 / 8.0 with a header claiming „every 14 seconds", which is the
// comment-versus-code trap this note replaces.
//
// ⚠️ THE LAYERS CROSS-FADE, THEY DO NOT ADD. Each transition takes the outgoing layer to 0 as
// the incoming one rises, because the three are taps over overlapping corpora — an ИСУН-funded
// contract is in `fund_projects` AND in `contracts` — so two columns standing on one city at
// once would read as a stack, i.e. as a total that has no name. `layers.ts` gives each its own
// maximum for the same reason.
//
// ⚠️ AND THE CAMERA MOVE IS SPLIT FROM THE LAYER CHANGE, deliberately. `blend` switches the
// caption at the segment's MIDPOINT while the weights lerp continuously, so a five-second
// transition names one layer for 2.5 s while a different one is still half-drawn. Each layer
// change therefore sits on its own SHORT segment (the camera arrives first and rests, then the
// layer changes over one second), which cuts that mismatch to about half a second.

import type { Programme } from "./index";
import { ZERO_WEIGHTS as OFF } from "../state";
import { OVERVIEW, SOFIA, BURGAS, VARNA } from "./anchors";

export const COLUMNS: Programme = {
  id: "columns",
  duration: 42,
  keyframes: [
    {
      t: 0,
      state: {
        camera: { target: OVERVIEW, distance: 900, pitch: 55, yaw: 0 },
        weights: { ...OFF, proc: 1 },
        arcs: 0,
        labels: 0.35,
        highlight: null,
        captionId: "columns_proc",
      },
      dwell: 2,
    },
    // In over the capital, which is 56% of the buyer side and the reason the layer looks the
    // way it does.
    {
      t: 6,
      state: {
        camera: { target: SOFIA, distance: 420, pitch: 38, yaw: 18 },
        labels: 1,
        highlight: "SOF",
      },
      dwell: 2,
    },
    // East along Тракия to the coast — camera only, so the layer change gets its own segment.
    {
      t: 12,
      state: {
        camera: { target: BURGAS, distance: 520, pitch: 40, yaw: -14 },
        highlight: null,
      },
      dwell: 2,
    },
    {
      t: 15,
      state: { weights: { ...OFF, funds: 1 }, captionId: "columns_funds" },
      dwell: 2,
    },
    {
      t: 21,
      state: { camera: { target: VARNA, distance: 460, pitch: 36, yaw: -6 } },
      dwell: 2,
    },
    {
      t: 27,
      state: {
        camera: { target: OVERVIEW, distance: 780, pitch: 48, yaw: 6 },
        labels: 0.6,
      },
      dwell: 2,
    },
    {
      t: 30,
      state: { weights: { ...OFF, agri: 1 }, captionId: "columns_agri" },
      dwell: 4,
    },
    // A slow pull outward while the subsidies are still up, so agri holds the frame rather
    // than losing it to the closing ease. The loop then closes onto keyframe 0 through
    // `stateAt`'s wrap — no terminal copy of the opening keyframe, which would be a no-op
    // segment and six frozen seconds.
    {
      t: 36,
      state: {
        camera: { target: OVERVIEW, distance: 860, pitch: 52, yaw: 2 },
      },
    },
  ],
};
