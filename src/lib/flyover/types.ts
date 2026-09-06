// The flyover engine's vocabulary — `docs/plans/home-flyover-v1.md` §0.2 and §4.
//
// ⚠️ THIS DIRECTORY MAY NOT IMPORT REACT, THE DOM BEYOND `CanvasRenderingContext2D`, OR
// ANYTHING THROUGH `@/`. Three callers share it and they do not share a resolver:
//
//   · the browser (`/`, and the article) — Vite, `@/` available;
//   · Node under `@napi-rs/canvas` — the poster and OG-image renderer;
//   · Remotion (`video/`), whose `video/tsconfig.json` deliberately excludes the app's alias
//     map, so it reaches the engine by RELATIVE path.
//
// One `@/` import therefore breaks `npm run video:check` and the render, and nothing in
// `npm run build` sees it (plan §14).
//
// ⚠️ AND THE WORLD TYPES HERE ARE THE ARTIFACT'S SHAPE, DECLARED SEPARATELY ON PURPOSE.
// `scripts/db/gen_home/flyover.ts` imports `node:fs`, so the engine cannot import its types
// without pulling Node into the browser bundle. The two are kept in step by an assignability
// check in `scripts/db/tests/flyover.data.test.ts`, which fails the build — not at runtime —
// when the generator's output stops satisfying what the engine expects to draw.

/** A point in the pre-projected planar frame, in integer TENTHS of a frame pixel. */
export type FramePoint = readonly [number, number];

/** One МИР polygon. `rings[i][0]` equals `rings[i].at(-1)`; coordinates are tenths. */
export interface WorldRegion {
  /** The money-grain oblast this МИР belongs to — Sofia's three МИР share one. */
  oblast: string;
  rings: number[][][];
  /** Label / depth-sort point: the area-weighted centroid of the largest ring. */
  c: FramePoint;
}

/** `[x, y, nameBg, nameEn]` — where an oblast's column stands, and what it is called. */
export type WorldCity = readonly [number, number, string, string];

/** The money layers, in the order the columns programme cycles them. */
export const MONEY_LAYERS = ["proc", "funds", "agri"] as const;
export type MoneyLayerId = (typeof MONEY_LAYERS)[number];

/** Every layer a `FlyoverState` can weight, money and overlay alike. */
export const LAYER_IDS = [...MONEY_LAYERS, "elections", "prices"] as const;
export type LayerId = (typeof LAYER_IDS)[number];

export interface WorldCoverage {
  totalEur: number;
  bothPlacedEur: number;
  buyerPlacedEur: number;
  unplaced: {
    trNoSeat: number;
    notInTr: number;
    carriers: number;
    synthetic: number;
    buyerUnplaced: number;
  };
}

/**
 * How the consortium carriers were placed — the generator's `FlyoverCarrierLead`.
 *
 * ⚠️ OPTIONAL HERE AND REQUIRED THERE, DELIBERATELY. The generator always emits it, but the
 * browser fetches whatever object the bucket currently holds — and between shipping the bundle
 * and syncing the artifact, that is an object minted before this field existed. Required, the
 * shape gate in `useFlyoverArtifact` would reject it and `/` would fall back to the poster for
 * the length of a deploy; optional, the arcs still draw and only the one caption stays quiet.
 */
export interface WorldCarrierLead {
  /** Money placed at a lead member. A SUBSET of `coverage.bothPlacedEur`. */
  eur: number;
  consortia: number;
  unplaced: number;
  /** Groups whose placed members span more than one oblast — where the lead is a CHOICE. */
  multiOblast: number;
}

export interface WorldFlows {
  scope: string;
  /** The 28 oblast codes, sorted — row and column keys of `m`. */
  keys: string[];
  /** `m[buyer][contractor]` in whole M€. */
  m: number[][];
  coverage: WorldCoverage;
  carrierLead?: WorldCarrierLead;
}

export interface WorldElectionRegion {
  nick: string;
  color: string;
  share: number;
}

/**
 * Everything the engine draws from. It is exactly `data/home/flyover.json`, and the engine
 * never fetches it — a caller hands it over, so the same object serves the browser, Node and
 * Remotion.
 */
export interface FlyoverWorld {
  v: number;
  computedAt: string;
  frame: { w: number; h: number };
  geo: {
    regions: Record<string, WorldRegion>;
    cities: Record<string, WorldCity>;
  };
  /**
   * ⚠️ ONLY `proc` IS SCOPED beyond `all`: `fund_projects` has no date column and
   * `agri_subsidies` is annual, so a parliament window over either would be invented.
   */
  layers: Record<string, Partial<Record<MoneyLayerId, Record<string, number>>>>;
  pop: Record<string, number>;
  flows: WorldFlows;
  elections?: Record<string, Record<string, WorldElectionRegion>>;
  prices?: {
    asOf: string;
    /** МИР keys (31), not oblast codes — the price panel's grain, and the polygons'. */
    byMir: Record<string, number>;
    national: number;
  };
  figures: {
    procTotalEur: number;
    procContracts: number;
    sofiaBuyerShare: number;
    /** ⚠️ Shares of the both-placed HALF, not of procurement. See the artifact's own docs. */
    sameOblastArcShare: number;
    intoSofiaArcShare: number;
    outOfSofiaArcShare: number;
    /** `[buyer, contractor, M€]`. */
    topFlow: [string, string, number];
    fundsPlacedEur: number;
    fundsTotalEur: number;
    agriTotalEur: number;
  };
  available: {
    proc: boolean;
    funds: boolean;
    agri: boolean;
    flows: boolean;
    elections: boolean;
    prices: boolean;
    scopedLayers: MoneyLayerId[];
  };
}

/**
 * A pinhole camera over the frame.
 *
 * The frame lies flat: world X is the frame's x, world Z is the frame's y (so south is +Z),
 * and world Y is HEIGHT — the axis columns rise along. Coordinates are frame pixels, not
 * tenths; `scaleFrame` in `camera.ts` is the one place the conversion happens.
 *
 * ⚠️ `pitch` and `yaw` are DEGREES, because a keyframe table is read by humans and a camera
 * path written in radians is unreviewable. `blend` interpolates yaw the SHORT way around, so
 * a path from 350° to 10° sweeps 20° rather than 340°.
 */
export interface Camera {
  /** Where the camera looks, in frame pixels: `[x, z]`, always on the ground plane. */
  target: readonly [number, number];
  /** Distance from the target, in frame pixels. */
  distance: number;
  /** Degrees above the ground plane. 0 would put the camera on the ground; 90 straight above. */
  pitch: number;
  /** Degrees clockwise from due south. 0 looks north, which is the map's natural orientation. */
  yaw: number;
}

/** The pixel box a frame is drawn into. */
export interface Viewport {
  w: number;
  h: number;
}

/** A projected point: screen pixels plus the camera-space depth used for painter's ordering. */
export interface Projected {
  x: number;
  y: number;
  /** Distance in front of the camera. Larger is further away; never ≤ 0 (those are clipped). */
  depth: number;
}
