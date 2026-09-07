// `render(ctx, world, state, opts)` — one frame, from a state, onto anything Ctx2D-shaped.
// `docs/plans/home-flyover-v1.md` §0.2 and §4.
//
// ⚠️ THE CLOCK IS AN ARGUMENT AND IS NEVER READ FROM THE ENVIRONMENT. `Date.now()` and
// `performance.now()` are banned here (and the isolation gate enforces it), because Remotion
// renders frame N of a video that has no wall clock, the poster renderer draws one frame in
// Node, and a test must be able to draw the same frame twice and compare. The clock drives
// only continuous effects — the arcs' dash offset and nothing else.
//
// ⚠️ AND `ctx` IS STRUCTURAL, NOT `CanvasRenderingContext2D`. The same function has to run
// against the browser's context, `@napi-rs/canvas`'s, Remotion's, and a RECORDER that logs
// the commands so a test can compare two frames without a canvas at all. `Ctx2D` below is the
// subset actually used; widening it is a decision about all four.

import { cameraBasis, groundPoint, project, type CameraBasis } from "./camera";
import {
  COLUMN_W,
  TOP_FLOWS,
  arcColor,
  arcLift,
  arcWidth,
  columnHeight,
  flowsTouching,
  layerMax,
  mixHex,
  priceColor,
  topFlows,
  type FlowArc,
  type FlyoverPalette,
} from "./layers";
import { MONEY_LAYERS } from "./types";
import type { FlyoverState } from "./state";
import type { FlyoverWorld, Projected, Viewport } from "./types";

/** The 2D drawing surface the engine needs, and no more. */
export interface Ctx2D {
  save(): void;
  restore(): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  closePath(): void;
  fill(): void;
  stroke(): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  setLineDash(segments: number[]): void;
  // ⚠️ WIDER THAN THE ENGINE WRITES, on purpose. The engine only ever assigns a string, but
  // TypeScript compares mutable properties INVARIANTLY — so a narrow `string` here makes the
  // browser's own `CanvasRenderingContext2D` not assignable to `Ctx2D`, and the host would
  // have to cast at the one call site where a real mismatch should fail.
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineJoin: CanvasLineJoin;
  lineCap: CanvasLineCap;
  globalAlpha: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  lineDashOffset: number;
}

export interface RenderOptions {
  viewport: Viewport;
  palette: FlyoverPalette;
  /**
   * Seconds. Drives the arcs' dash offset and nothing else — see the header.
   */
  clock: number;
  /** Which money scope to read: `"all"` or a `"ns:<date>"` window. */
  scope?: string;
  /** BG or EN city labels. The only text the canvas draws. */
  lang?: "bg" | "en";
  /** How many flows the arcs may draw; narrow viewports pass fewer. */
  maxFlows?: number;
  /** Which election the overlay shows. Defaults to the most recent in the artifact. */
  electionDate?: string;
  /** Continuously blend two explicit election results; used by article/video chapter six. */
  electionTransition?: {
    from: string;
    to: string;
    progress: number;
  };
}

/** A primitive with a depth, so painter's order can be a single sort. */
interface Drawable {
  depth: number;
  draw: () => void;
}

const CAPITAL = "SOF";

/**
 * The one endpoint that deliberately has no place on the map (plan §7 step 4).
 *
 * `coverage.unplaced.notInTr` combines foreign suppliers and Bulgarian public bodies that
 * have no Commerce-Registry row. Giving either population an oblast would be a guess, so the
 * renderer keeps the amount in SCREEN space, beyond the geography, instead of inventing a
 * world coordinate. The first arcs caption names what the marker means; the canvas carries
 * only the euro figure, preserving the rule that translatable prose stays in the DOM.
 */
const drawOffMapEndpoint = (
  ctx: Ctx2D,
  eur: number,
  palette: FlyoverPalette,
  alpha: number,
  viewport: Viewport,
): void => {
  if (!(eur > 0) || !(alpha > 0)) return;

  const r = Math.max(6, Math.min(12, Math.min(viewport.w, viewport.h) * 0.016));
  const x = viewport.w - Math.max(42, viewport.w * 0.075);
  const y = Math.max(36, viewport.h * 0.16);
  const label = `${(eur / 1e9).toFixed(1)}B`;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = palette.arcNeutral;
  ctx.fillStyle = palette.arcNeutral;
  ctx.lineWidth = Math.max(1.5, r * 0.22);
  ctx.lineCap = "round";
  ctx.setLineDash([Math.max(3, r * 0.6), Math.max(3, r * 0.6)]);
  ctx.beginPath();
  ctx.moveTo(x - r * 4.2, y);
  ctx.lineTo(x - r * 1.35, y);
  ctx.stroke();

  // An open diamond: a destination outside the mapped key space, not a 29th oblast.
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.stroke();

  const amountTop = y + r + 5;
  const amountPx = Math.max(10, Math.round(viewport.h / 30));
  const euroX = x - r * 1.35;
  const euroY = amountTop + amountPx * 0.5;
  const euroR = amountPx * 0.34;
  // Draw the currency mark as geometry. The portable Node-canvas fallback used for the
  // committed posters has no € glyph; putting it in `fillText` renders a tofu box even though
  // the browser is fine. Two short bars across an open, angular C remain legible at 10 px.
  ctx.beginPath();
  ctx.moveTo(euroX + euroR * 0.65, euroY - euroR);
  ctx.lineTo(euroX - euroR * 0.3, euroY - euroR);
  ctx.lineTo(euroX - euroR, euroY);
  ctx.lineTo(euroX - euroR * 0.3, euroY + euroR);
  ctx.lineTo(euroX + euroR * 0.65, euroY + euroR);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(euroX - euroR * 0.85, euroY - euroR * 0.28);
  ctx.lineTo(euroX + euroR * 0.45, euroY - euroR * 0.28);
  ctx.moveTo(euroX - euroR * 0.85, euroY + euroR * 0.28);
  ctx.lineTo(euroX + euroR * 0.45, euroY + euroR * 0.28);
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = fontFor(amountPx);
  ctx.lineWidth = 3;
  ctx.strokeStyle = palette.labelHalo;
  ctx.fillStyle = palette.label;
  ctx.strokeText(label, x - r * 0.4, amountTop);
  ctx.fillText(label, x - r * 0.4, amountTop);
  ctx.restore();
};

const fontFor = (px: number): string =>
  `600 ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

/**
 * Ring → screen. Returns `null` when ANY vertex is behind the lens: drawing a partially
 * clipped ring by skipping its clipped points closes the polygon across the frame, which
 * paints a wedge over half the country rather than dropping one shape.
 */
const projectRing = (
  ring: number[][],
  basis: CameraBasis,
): Projected[] | null => {
  const out: Projected[] = [];
  for (const pt of ring) {
    const x = pt[0];
    const y = pt[1];
    if (x === undefined || y === undefined) return null;
    const p = project(groundPoint(x, y), basis);
    if (!p) return null;
    out.push(p);
  }
  return out.length >= 3 ? out : null;
};

const meanDepth = (pts: Projected[]): number => {
  let sum = 0;
  for (const p of pts) sum += p.depth;
  return sum / pts.length;
};

const tracePath = (ctx: Ctx2D, pts: Projected[]): void => {
  const first = pts[0];
  if (!first) return;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p) ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
};

/** The fill for one МИР, before the overlays weigh in. */
const regionFill = (
  world: FlyoverWorld,
  key: string,
  state: FlyoverState,
  palette: FlyoverPalette,
  electionDate?: string,
  electionTransition?: RenderOptions["electionTransition"],
): string => {
  const region = world.geo.regions[key];
  let fill = palette.land;
  if (!region) return fill;
  const priceW = state.weights.prices;
  if (priceW > 0 && world.prices?.byMir[key] !== undefined) {
    fill = mixHex(fill, priceColor(world.prices.byMir[key], palette), priceW);
  }
  const electionW = state.weights.elections;
  if (electionW > 0 && world.elections) {
    const toHex = (color: string): string => {
      if (/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color.trim())) return color;
      const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(
        color.trim(),
      );
      if (!rgb) return color;
      return `#${rgb
        .slice(1)
        .map((part) =>
          Math.max(0, Math.min(255, Number(part)))
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")}`;
    };
    let overlay: { color: string; share: number } | undefined;
    if (electionTransition) {
      const from = world.elections[electionTransition.from]?.[key];
      const to = world.elections[electionTransition.to]?.[key];
      if (from && to) {
        const progress = Math.max(0, Math.min(1, electionTransition.progress));
        overlay = {
          color: mixHex(toHex(from.color), toHex(to.color), progress),
          share: from.share + (to.share - from.share) * progress,
        };
      } else if (to ?? from) {
        const result = (to ?? from)!;
        overlay = { color: toHex(result.color), share: result.share };
      }
    } else if (electionDate) {
      const win = world.elections[electionDate]?.[key];
      if (win) overlay = { color: toHex(win.color), share: win.share };
    }
    if (overlay) {
      // Hue names the winner; tint strength carries their vote share. Retain a base tint so a
      // low plurality is still identifiable, then devote the remaining range to the share.
      const share = Math.max(0, Math.min(100, overlay.share)) / 100;
      fill = mixHex(fill, overlay.color, electionW * (0.45 + 0.45 * share));
    }
  }
  if (state.highlight && region.oblast === state.highlight) {
    fill = mixHex(fill, palette.landHighlight, 0.6);
  }
  return fill;
};

/** The four faces of one extruded column, back to front. */
const drawColumn = (
  ctx: Ctx2D,
  basis: CameraBasis,
  x: number,
  z: number,
  height: number,
  color: string,
  alpha: number,
): void => {
  const half = COLUMN_W / 2;
  const corners: [number, number][] = [
    [x - half, z - half],
    [x + half, z - half],
    [x + half, z + half],
    [x - half, z + half],
  ];
  const base = corners.map(([cx, cz]) => project([cx, 0, cz], basis));
  const top = corners.map(([cx, cz]) => project([cx, height, cz], basis));
  if (base.some((p) => !p) || top.some((p) => !p)) return;
  const b = base as Projected[];
  const t = top as Projected[];

  ctx.save();
  ctx.globalAlpha = alpha;
  // Sides first, darkened, then the cap — enough shading to read as a solid at this size
  // without a lighting model the engine has no business carrying.
  const side = mixHex(color, "#000000", 0.28);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const bi = b[i];
    const bj = b[j];
    const ti = t[i];
    const tj = t[j];
    if (!bi || !bj || !ti || !tj) continue;
    ctx.fillStyle = side;
    ctx.beginPath();
    ctx.moveTo(bi.x, bi.y);
    ctx.lineTo(bj.x, bj.y);
    ctx.lineTo(tj.x, tj.y);
    ctx.lineTo(ti.x, ti.y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = color;
  tracePath(ctx, t);
  ctx.fill();
  ctx.restore();
  // No return: the caller's depth key is the BASE CENTRE (plan §4), which it already has, and
  // a mean over the four corners here was computed and discarded on every column of every
  // frame.
};

const drawArc = (
  ctx: Ctx2D,
  basis: CameraBasis,
  world: FlyoverWorld,
  flow: FlowArc,
  maxEur: number,
  palette: FlyoverPalette,
  alpha: number,
  clock: number,
): Drawable | null => {
  const a = world.geo.cities[flow.from];
  const b = world.geo.cities[flow.to];
  if (!a || !b) return null;
  const ax = a[0] / 10;
  const az = a[1] / 10;
  const bx = b[0] / 10;
  const bz = b[1] / 10;
  const dx = bx - ax;
  const dz = bz - az;
  const length = Math.hypot(dx, dz) || 1;
  const lift = arcLift(dx, dz);
  // Reciprocal flows must not occupy the SAME Bézier. The direction's left-hand normal
  // reverses with it, so A→B and B→A bend to opposite sides without another identity or a
  // special case. Static posters can now distinguish the two colours; animation direction is
  // no longer the only evidence that two quantities are present.
  const bend = Math.min(18, length * 0.12);
  const nx = -dz / length;
  const nz = dx / length;
  const p0 = project([ax, 0, az], basis);
  const p1 = project(
    [(ax + bx) / 2 + nx * bend, lift, (az + bz) / 2 + nz * bend],
    basis,
  );
  const p2 = project([bx, 0, bz], basis);
  if (!p0 || !p1 || !p2) return null;
  const width = arcWidth(flow.eur, maxEur);
  const color = arcColor(flow, palette, CAPITAL);
  return {
    depth: (p0.depth + p2.depth) / 2,
    draw: () => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      // The dash is the ONLY thing the clock drives, and it is what makes a flow read as a
      // direction rather than a line between two dots.
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = -clock * 26;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
      ctx.stroke();
      // No `setLineDash([])`: the dash list and offset are canvas STATE, so `restore()` below
      // resets both. The explicit call was a no-op that added one entry per arc — up to 40 a
      // frame — to the command log the recorder exists to let a human diff.
      ctx.restore();
    },
  };
};

/**
 * Draw one frame.
 *
 * Order is polygons, then columns and arcs together, sorted back to front. Painter's order is
 * the only depth resolution a 2D canvas has: without the sort, a column in Видин draws over
 * the Черно море coast because it happened to come later in the artifact's key order.
 */
export const render = (
  ctx: Ctx2D,
  world: FlyoverWorld,
  state: FlyoverState,
  opts: RenderOptions,
): void => {
  const { viewport, palette, clock } = opts;
  const scope = opts.scope ?? "all";
  const lang = opts.lang ?? "bg";
  const basis = cameraBasis(state.camera, viewport);
  // Once per FRAME, not once per region: `regionFill` runs 31 times a frame and this cannot
  // change within one. `CameraBasis` carries the same rule for the same reason.
  //
  // ⚠️ A named date the artifact does not carry falls back to the most recent rather than to
  // nothing: an unknown date and `weights.elections: 0` would otherwise draw identically, so a
  // one-digit typo would read as „no election happened".
  const electionDates = world.elections
    ? Object.keys(world.elections).sort()
    : [];
  const electionDate =
    opts.electionDate && world.elections?.[opts.electionDate]
      ? opts.electionDate
      : electionDates.at(-1);

  ctx.save();
  ctx.clearRect(0, 0, viewport.w, viewport.h);
  ctx.lineJoin = "round";

  // ── the land ────────────────────────────────────────────────────────────────────────
  const polys: Drawable[] = [];
  for (const [key, region] of Object.entries(world.geo.regions)) {
    const fill = regionFill(
      world,
      key,
      state,
      palette,
      electionDate,
      opts.electionTransition,
    );
    for (const ring of region.rings) {
      const pts = projectRing(ring, basis);
      if (!pts) continue;
      // ⚠️ The artifact's own area-weighted centroid (plan §4: „polygon: centroid"), not the
      // mean of the projected vertices — which is a different quantity (the projected mean
      // rather than the mean's projection, and unweighted by area) and would leave `geo.c`
      // shipped in every artifact and read by nothing. `meanDepth` is the fallback for a
      // centroid that clips, which a ring wrapping the camera can do.
      const anchor = project(groundPoint(region.c[0], region.c[1]), basis);
      polys.push({
        depth: anchor?.depth ?? meanDepth(pts),
        draw: () => {
          ctx.fillStyle = fill;
          ctx.strokeStyle = palette.landEdge;
          ctx.lineWidth = 0.8;
          tracePath(ctx, pts);
          ctx.fill();
          ctx.stroke();
        },
      });
    }
  }
  polys.sort((a, b) => b.depth - a.depth);
  for (const p of polys) p.draw();

  // ── columns and arcs, one depth-sorted pass ─────────────────────────────────────────
  const raised: Drawable[] = [];

  for (const layer of MONEY_LAYERS) {
    const weight = state.weights[layer];
    if (weight <= 0) continue;
    const values = world.layers[scope]?.[layer];
    if (!values) continue;
    const max = layerMax(world, scope, layer);
    for (const [code, value] of Object.entries(values)) {
      const city = world.geo.cities[code];
      if (!city) continue;
      const h = columnHeight(value, max) * weight;
      if (h <= 0.5) continue;
      // ⚠️ Sofia's column stands at the CITY, which is where `geo.cities` puts it — the S23
      // МИР centroid is ~13 km south (plan §14). Nothing here may fall back to a centroid.
      const x = city[0] / 10;
      const z = city[1] / 10;
      const fill = palette.column[layer];
      // The base centre IS the depth key (plan §4), so the probe is not an extra projection —
      // it is the one `drawColumn` used to duplicate and throw away.
      const probe = project([x, 0, z], basis);
      if (!probe) continue;
      raised.push({
        depth: probe.depth,
        draw: () => drawColumn(ctx, basis, x, z, h, fill, weight),
      });
    }
  }

  if (state.arcs > 0 && world.flows.keys.length) {
    const limit = opts.maxFlows ?? TOP_FLOWS;
    const flows = state.highlight
      ? [...flowsTouching(world, state.highlight), ...topFlows(world, limit)]
      : topFlows(world, limit);
    const seen = new Set<string>();
    let maxEur = 0;
    for (const f of flows) if (f.eur > maxEur) maxEur = f.eur;
    for (const flow of flows) {
      const id = `${flow.from}>${flow.to}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const d = drawArc(
        ctx,
        basis,
        world,
        flow,
        maxEur,
        palette,
        state.arcs,
        clock,
      );
      if (d) raised.push(d);
    }
  }

  raised.sort((a, b) => b.depth - a.depth);
  for (const r of raised) r.draw();

  // This is NOT another flow cell: the corpus has no contractor oblast to put on the other
  // end. One aggregate endpoint and its euro amount make the missing geography visible without
  // manufacturing a location or implying that the map's 28×28 matrix contains it.
  // A collapsed camera projects no country; do not leave a contextless euro marker floating
  // on an otherwise blank frame. `polys` is the rendering result, not a second validity rule.
  if (polys.length > 0) {
    drawOffMapEndpoint(
      ctx,
      world.flows.coverage.unplaced.notInTr,
      palette,
      state.arcs,
      viewport,
    );
  }

  // ── city labels ─────────────────────────────────────────────────────────────────────
  if (state.labels > 0) {
    ctx.save();
    ctx.globalAlpha = state.labels;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    const fontSize = Math.max(9, Math.round(viewport.h / 34));
    ctx.font = fontFor(fontSize);
    ctx.lineWidth = 3;
    ctx.strokeStyle = palette.labelHalo;
    ctx.fillStyle = palette.label;
    const labels: { p: Projected; text: string }[] = [];
    for (const city of Object.values(world.geo.cities)) {
      const p = project([city[0] / 10, 0, city[1] / 10], basis);
      if (!p) continue;
      labels.push({ p, text: lang === "en" ? city[3] : city[2] });
    }
    labels.sort((a, b) => b.p.depth - a.p.depth);
    const occupied: Array<{ l: number; r: number; t: number; b: number }> = [];
    for (const l of labels) {
      // Canvas hosts disagree slightly on text metrics, so use one deterministic conservative
      // estimate rather than `measureText`. Dense oblast capitals then disappear as a whole
      // label instead of colliding into an unreadable string in committed poster fallbacks.
      const width = Math.max(fontSize * 2, l.text.length * fontSize * 0.58);
      const box = {
        l: l.p.x - width / 2 - 2,
        r: l.p.x + width / 2 + 2,
        t: l.p.y - fontSize - 8,
        b: l.p.y,
      };
      if (
        occupied.some(
          (other) =>
            box.l < other.r &&
            box.r > other.l &&
            box.t < other.b &&
            box.b > other.t,
        )
      ) {
        continue;
      }
      occupied.push(box);
      // Halo first, so a label over a dark column stays readable without a background box.
      ctx.strokeText(l.text, l.p.x, l.p.y - 4);
      ctx.fillText(l.text, l.p.x, l.p.y - 4);
    }
    ctx.restore();
  }

  ctx.restore();
};
