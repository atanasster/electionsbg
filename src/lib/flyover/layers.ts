// What the engine draws, in world coordinates — column heights, arc curves and colour ramps.
// `docs/plans/home-flyover-v1.md` §4.
//
// ⚠️ THE ENGINE HOLDS NO HEX. Colours arrive as a `FlyoverPalette` resolved from CSS variables
// in the browser (so the scene follows the theme) and from the brand palette in Node and
// Remotion. A constant here would be right in one of the three and wrong in the other two.
//
// ⚠️ AND NOTHING HERE SUMS TWO MONEY LAYERS. Procurement, EU funds and farm subsidies are
// three taps over overlapping corpora — an ИСУН-funded contract is in `fund_projects` AND in
// `contracts` — so their sum is a quantity with no name. Each layer gets its OWN maximum for
// exactly that reason: they are compared within themselves, never against each other.

import { lerp } from "./math";
import type { FlyoverWorld, MoneyLayerId } from "./types";

/** The tallest a column may stand, in frame pixels. Bulgaria's frame is 1000 × 625. */
export const COLUMN_MAX_H = 150;

/** Column footprint, in frame pixels. */
export const COLUMN_W = 9;

/** How many flows the arcs programme draws before the picture becomes a ball of string. */
export const TOP_FLOWS = 40;

/** The narrow-viewport count — plan §8.5, where the band also drops to 24 fps. */
export const TOP_FLOWS_NARROW = 20;

/**
 * The colours a host supplies.
 *
 * ⚠️ EVERY VALUE MUST BE `#rgb` OR `#rrggbb`. `mixHex` is the engine's one colour operation
 * and parses nothing else — it returns the nearer END instead, which silently turns the column
 * shading, the price ramp, the election cross-fade and the highlight into hard steps, at a 200,
 * all four at once. This repo's CSS variables hold BARE HSL TRIPLES (`--background: 39 33% 92%`,
 * consumed as `hsl(var(--background))`) and `getComputedStyle` returns `rgb(…)`, so a browser
 * host MUST convert to hex; `@napi-rs/canvas` and Remotion pass the brand palette, already hex.
 */
export interface FlyoverPalette {
  /** Polygon fill and edge. */
  land: string;
  landEdge: string;
  /** The polygon under the highlighted oblast. */
  landHighlight: string;
  /** Column colour per money layer — three taps, three colours, never one scale. */
  column: Record<MoneyLayerId, string>;
  /** Arc colours. „Into the capital", „out of it", and everything else. */
  arcIn: string;
  arcOut: string;
  arcNeutral: string;
  /** City labels — the only text the canvas itself draws. */
  label: string;
  labelHalo: string;
  /** The two ends of the price ramp: cheaper than the baseline, dearer than it. */
  priceDown: string;
  priceUp: string;
}

/**
 * The largest value in a layer, which is what every column in it is scaled against.
 *
 * ⚠️ PER LAYER, NEVER SHARED. Sofia dominates procurement about 9:1 and EU funds about 4:1
 * while farm subsidies are almost flat, so one shared maximum would draw the agri layer as 28
 * invisible stubs — the layer whose whole point is that the countryside inverts the map.
 */
export const layerMax = (
  world: FlyoverWorld,
  scope: string,
  layer: MoneyLayerId,
): number => {
  const values = Object.values(world.layers[scope]?.[layer] ?? {});
  let max = 0;
  for (const v of values) if (v > max) max = v;
  return max;
};

/**
 * Column height in frame pixels.
 *
 * ⚠️ SQUARE ROOT, and it is a judgement rather than a nicety. Linear heights put Sofia at 150
 * px and Видин at 1.4 — a column a reader cannot see is a claim that Видин buys nothing. The
 * root compresses the ratio to about 3:1, which keeps every oblast legible while leaving the
 * capital obviously dominant. It is NOT an area encoding: the caption carries the euro.
 */
export const columnHeight = (value: number, max: number): number => {
  if (!(value > 0) || !(max > 0)) return 0;
  return COLUMN_MAX_H * Math.sqrt(Math.min(value, max) / max);
};

export interface FlowArc {
  from: string;
  to: string;
  /** Whole M€ — the flow matrix's own grain. */
  eur: number;
}

/**
 * The one flow order, shared by both producers below.
 *
 * ⚠️ THREE KEYS, NOT TWO. Two flows out of one buyer can carry the same whole-M€ cell — the
 * matrix is stored in whole millions and small cells repeat — and a comparator that returns
 * `1` for both `(a, b)` and `(b, a)` is not a strict weak ordering, so the result is whatever
 * the host's sort does. `Array.prototype.sort` is only specified to be stable for a CONSISTENT
 * comparator. That is exactly the cross-runtime determinism `recorder.ts` exists to check, and
 * `topFlows` ends in `slice(limit)` — so which arcs survive the top-40 boundary could differ
 * between a Chrome visitor, a Safari visitor and the poster renderer, on a picture whose whole
 * subject is which flows exist.
 */
export const byMoneyThenKey = (a: FlowArc, b: FlowArc): number =>
  b.eur - a.eur ||
  (a.from < b.from
    ? -1
    : a.from > b.from
      ? 1
      : a.to < b.to
        ? -1
        : a.to > b.to
          ? 1
          : 0);

/**
 * The flows worth drawing, largest first.
 *
 * ⚠️ THE DIAGONAL IS EXCLUDED, and it is the largest single quantity in the matrix: 56.5% of
 * the both-placed money stays inside the buyer's own oblast. An arc from a point to itself is
 * not a small arc, it is nothing — so that share is a CAPTION, never a curve, and a consumer
 * summing the drawn arcs is looking at 44% of the placed quarter rather than at the corpus.
 */
export const topFlows = (world: FlyoverWorld, limit = TOP_FLOWS): FlowArc[] => {
  const { keys, m } = world.flows;
  const out: FlowArc[] = [];
  for (let i = 0; i < keys.length; i++) {
    const from = keys[i];
    const row = m[i];
    if (!from || !row) continue;
    for (let j = 0; j < keys.length; j++) {
      if (i === j) continue;
      const to = keys[j];
      const eur = row[j] ?? 0;
      if (to && eur > 0) out.push({ from, to, eur });
    }
  }
  out.sort(byMoneyThenKey);
  return out.slice(0, Math.max(0, limit));
};

/** Every flow touching one oblast, in or out — what the tour adds when it picks one out. */
export const flowsTouching = (world: FlyoverWorld, code: string): FlowArc[] => {
  const { keys, m } = world.flows;
  const idx = keys.indexOf(code);
  if (idx === -1) return [];
  const out: FlowArc[] = [];
  const own = m[idx];
  for (let j = 0; j < keys.length; j++) {
    if (j === idx) continue;
    const other = keys[j];
    if (!other) continue;
    const outward = own?.[j] ?? 0;
    if (outward > 0) out.push({ from: code, to: other, eur: outward });
    const inward = m[j]?.[idx] ?? 0;
    if (inward > 0) out.push({ from: other, to: code, eur: inward });
  }
  out.sort(byMoneyThenKey);
  return out;
};

/** Arc stroke width in frame pixels: ∝ √€, so a 10× flow is ~3× the line, not 10×. */
export const arcWidth = (eur: number, max: number): number => {
  if (!(eur > 0) || !(max > 0)) return 0;
  return 0.7 + 3.6 * Math.sqrt(Math.min(eur, max) / max);
};

/**
 * How high an arc lifts at its apex, in frame pixels — proportional to the distance it spans,
 * so a Sofia→Varna flow arches and a Sofia→Pernik one barely leaves the ground.
 */
export const arcLift = (dx: number, dz: number): number =>
  Math.min(200, 18 + 0.45 * Math.hypot(dx, dz));

/**
 * The colour a flow is drawn in.
 *
 * The capital is the whole finding — 23.9% of the placed money flows INTO Sofia-city
 * contractors from buyers elsewhere and 11.8% flows out — so the two directions are the
 * two colours, and everything else is neutral rather than a third opinion.
 */
export const arcColor = (
  flow: FlowArc,
  palette: FlyoverPalette,
  capital = "SOF",
): string => {
  if (flow.to === capital) return palette.arcIn;
  if (flow.from === capital) return palette.arcOut;
  return palette.arcNeutral;
};

/** Blend two `#rrggbb` colours. The engine's ONE colour operation; hosts supply the ends. */
export const mixHex = (a: string, b: string, k: number): string => {
  const parse = (h: string): [number, number, number] => {
    const s = h.replace("#", "");
    const full =
      s.length === 3
        ? `${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`
        : s.padEnd(6, "0").slice(0, 6);
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ];
  };
  // A palette can legitimately hold a non-hex CSS colour (`oklch(...)`, a var()); mixing is
  // then not possible, so the nearer end is returned rather than a black that looks chosen.
  if (!/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(a.trim())) return k < 0.5 ? a : b;
  if (!/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(b.trim())) return k < 0.5 ? a : b;
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const to2 = (n: number) =>
    Math.round(Math.max(0, Math.min(255, n)))
      .toString(16)
      .padStart(2, "0");
  return `#${to2(lerp(ar, br, k))}${to2(lerp(ag, bg, k))}${to2(lerp(ab, bb, k))}`;
};

/**
 * The price overlay's colour for one МИР.
 *
 * The index is „100 = 2 January 2026", so the neutral point is 100 and the ramp is DIVERGING.
 * A sequential ramp anchored at zero would render a 2% fall and a 2% rise as almost the same
 * colour, which is the whole content of the layer.
 */
export const priceColor = (
  index: number,
  palette: FlyoverPalette,
  span = 4,
): string => {
  const k = Math.max(-1, Math.min(1, (index - 100) / span));
  return k < 0
    ? mixHex(palette.land, palette.priceDown, -k)
    : mixHex(palette.land, palette.priceUp, k);
};
