// The water hub scenes' one hard constraint, copied from the culture gate:
// `InfographicTile` overlays the tile's `metric` at the banner's BOTTOM-LEFT, so
// no `var(--sector)`-filled rect/circle may overlap x < 132 AND y > 72. Six of
// the twelve water tiles carry a metric, so a violation here is visible.

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { WATER_SCENES } from "./waterScenes";

const ACCENT = "var(--sector)";
const X_LIMIT = 132;
const Y_LIMIT = 72;

/** Every accent-filled rect/circle/ellipse, as a bounding box. `path` is excluded
 *  deliberately: its geometry is not parseable this cheaply, so the scenes keep
 *  accent-filled paths out of the danger zone by construction and by review. */
const accentBoxes = (svg: string) => {
  const boxes: {
    x0: number;
    x1: number;
    y0: number;
    y1: number;
    tag: string;
  }[] = [];
  for (const m of svg.matchAll(/<(rect|circle|ellipse)\b([^>]*)>/g)) {
    const [, tag, attrs] = m;
    if (!attrs.includes(`fill="${ACCENT}"`)) continue;
    const n = (k: string) => {
      const v = attrs.match(new RegExp(`\\b${k}="([-\\d.]+)"`));
      return v ? Number(v[1]) : undefined;
    };
    if (tag === "rect") {
      const x = n("x") ?? 0,
        y = n("y") ?? 0;
      boxes.push({
        x0: x,
        x1: x + (n("width") ?? 0),
        y0: y,
        y1: y + (n("height") ?? 0),
        tag,
      });
    } else {
      const cx = n("cx") ?? 0,
        cy = n("cy") ?? 0,
        rx = n("rx") ?? n("r") ?? 0,
        ry = n("ry") ?? n("r") ?? 0;
      boxes.push({ x0: cx - rx, x1: cx + rx, y0: cy - ry, y1: cy + ry, tag });
    }
  }
  return boxes;
};

describe("water hub scenes", () => {
  it("renders every scene", () => {
    for (const [id, Scene] of Object.entries(WATER_SCENES)) {
      const svg = renderToStaticMarkup(createElement(Scene));
      expect(svg, `scene "${id}" rendered nothing`).toContain("<svg");
    }
  });

  it("keeps accent-filled marks out of the metric's corner", () => {
    for (const [id, Scene] of Object.entries(WATER_SCENES)) {
      const svg = renderToStaticMarkup(createElement(Scene));
      for (const b of accentBoxes(svg)) {
        const overlaps = b.x0 < X_LIMIT && b.y1 > Y_LIMIT;
        expect(
          overlaps,
          `scene "${id}": an accent-filled <${b.tag}> reaches ` +
            `x=${b.x0}…${b.x1}, y=${b.y0}…${b.y1}, which overlaps the metric ` +
            `overlay (x < ${X_LIMIT} and y > ${Y_LIMIT}). Move it right or up.`,
        ).toBe(false);
      }
    }
  });

  it("actually finds accent marks, so the box check is not vacuous", () => {
    const total = Object.values(WATER_SCENES).reduce(
      (n, Scene) =>
        n + accentBoxes(renderToStaticMarkup(createElement(Scene))).length,
      0,
    );
    expect(total).toBeGreaterThan(20);
  });
});
