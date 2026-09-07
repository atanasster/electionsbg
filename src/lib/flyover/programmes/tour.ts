// „The guided tour" — five home chapters, plus the article-only elections chapter.
//
// ⚠️ THIS TABLE IS THE SPINE OF THREE SURFACES, WHICH IS WHY THE CHAPTER STATES ARE EXPORTED
// SEPARATELY FROM THE PROGRAMME. The home band reads it through `stateAt` on a timer; the
// ARTICLE maps scroll position to (chapter, intra-chapter t) and reads the same table; and the
// VIDEO takes the chapter STATES and gives them the durations the narration measured, because
// Remotion has no loop. If the three ever derived their camera from three tables, the same
// chapter would show three different pictures of the same sentence.
//
// ⚠️ THE ELECTIONS OVERLAY IS DELIBERATELY NOT HERE. It is chapter 6 of the article (plan §5)
// — the home tour ends on prices. A tour that ended on an election result would make the
// entry page's moving band a claim about a party rather than about money.

import { ZERO_WEIGHTS as OFF, type FlyoverState } from "../state";
import type { Programme } from "./index";
import { OVERVIEW, PLOVDIV, SOFIA, STARA_ZAGORA, VARNA } from "./anchors";

export interface TourChapter {
  /** Stable id — the article's `<section data-chapter>` and the video's scene key. */
  id: string;
  /** Seconds into the 40-second loop where this chapter begins. */
  t: number;
  /** The chapter's own state, as a PARTIAL accreted onto the one before it. */
  state: Partial<FlyoverState>;
  dwell: number;
}

/**
 * The five HOME chapters, in order. The article and video extend this table below; only the
 * home band reads `t`.
 */
export const TOUR_CHAPTERS: readonly TourChapter[] = [
  {
    // 1. Where the state buys — the buyer side, 56% of it in the capital.
    id: "buys",
    t: 0,
    state: {
      camera: { target: OVERVIEW, distance: 900, pitch: 52, yaw: 0 },
      weights: { ...OFF, proc: 1 },
      arcs: 0,
      labels: 0.4,
      highlight: null,
      captionId: "tour_buys",
    },
    dwell: 3,
  },
  {
    // 2. Where the money goes — the arcs, and their coverage.
    id: "goes",
    t: 8,
    state: {
      camera: { target: SOFIA, distance: 640, pitch: 28, yaw: 20 },
      weights: { ...OFF },
      arcs: 1,
      highlight: "SOF",
      captionId: "tour_goes",
    },
    dwell: 3,
  },
  {
    // 3. EU funds against procurement — and the half of the grant money with no oblast.
    id: "funds",
    t: 16,
    state: {
      camera: { target: STARA_ZAGORA, distance: 720, pitch: 44, yaw: -8 },
      weights: { ...OFF, funds: 1 },
      arcs: 0,
      highlight: null,
      captionId: "tour_funds",
    },
    dwell: 3,
  },
  {
    // 4. The countryside inverts the map: Пловдив and Добрич above the capital.
    id: "agri",
    t: 24,
    state: {
      camera: { target: PLOVDIV, distance: 640, pitch: 40, yaw: 10 },
      weights: { ...OFF, agri: 1 },
      captionId: "tour_agri",
    },
    dwell: 3,
  },
  {
    // 5. Prices since the euro — the one chapter that is not money the state spends.
    id: "prices",
    t: 32,
    state: {
      camera: { target: VARNA, distance: 820, pitch: 50, yaw: -12 },
      weights: { ...OFF, prices: 1 },
      labels: 0.7,
      captionId: "tour_prices",
    },
    dwell: 4,
  },
];

/**
 * The article's six chapters. The first five are the exact home-tour objects; the sixth keeps
 * the election result off `/` while still sharing the same camera/state vocabulary with the
 * article posters and Remotion. Keeping this as one exported table is what prevents those two
 * surfaces from quietly acquiring different pictures for the same chapter.
 */
export const ARTICLE_CHAPTERS: readonly TourChapter[] = [
  ...TOUR_CHAPTERS,
  {
    id: "elections",
    t: 40,
    state: {
      camera: { target: OVERVIEW, distance: 900, pitch: 62, yaw: 0 },
      weights: { ...OFF, elections: 1 },
      arcs: 0,
      labels: 0.55,
      highlight: null,
      captionId: null,
    },
    dwell: 4,
  },
];

export const TOUR: Programme = {
  id: "tour",
  duration: 40,
  keyframes: TOUR_CHAPTERS.map((c) => ({
    t: c.t,
    state: c.state,
    dwell: c.dwell,
  })),
};
