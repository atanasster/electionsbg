// „The guided tour" — the money-map article's six chapters.
//
// ⚠️ THIS TABLE IS THE SPINE OF THREE SURFACES. The ARTICLE maps scroll position to (chapter,
// intra-chapter t); the committed chapter stills and share card (`npm run
// home:flyover-posters`) are drawn from it; and the VIDEO takes the chapter STATES and gives
// them the durations the narration measured. If the three ever derived their camera from
// three tables, the same chapter would show three different pictures of the same sentence.
//
// The first five chapters were the retired home band's tour, which is why they are a separate
// export: `TOUR_CHAPTERS` is the money story, and the elections chapter is appended only for
// the article.

import { ZERO_WEIGHTS as OFF, type FlyoverState } from "../state";
import { OVERVIEW, PLOVDIV, SOFIA, STARA_ZAGORA, VARNA } from "./anchors";

export interface TourChapter {
  /** Stable id — the article's `<section data-chapter>` and the video's scene key. */
  id: string;
  /** The chapter's position on the article's timeline, in seconds. */
  t: number;
  /** The chapter's own state, as a PARTIAL accreted onto the one before it. */
  state: Partial<FlyoverState>;
  dwell: number;
}

/** The five money chapters, in order. `ARTICLE_CHAPTERS` extends this table below. */
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
    },
    dwell: 4,
  },
];

/**
 * The article's six chapters: the five money chapters plus the elections overlay, sharing the
 * same camera/state vocabulary with the article stills and Remotion. Keeping this as one exported table is what prevents those two
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
    },
    dwell: 4,
  },
];
