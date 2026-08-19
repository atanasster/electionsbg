// The scenes' one hard constraint: `InfographicTile` overlays the tile's `metric`
// large at the banner's BOTTOM-LEFT behind a radial scrim, so an accent-filled
// mark drawn there is either hidden by the number or fighting it.
//
// This is not hypothetical housekeeping — fundsScenes shipped its first cut with
// EIGHT of ten scenes breaking it, invisible only because the metrics were not
// wired yet and certain to bite the moment they were.
//
// ⚠️ NO CULTURE TILE SETS `metric` TODAY, so nothing is currently overlaid and a
// violation here would be invisible on the page. That is precisely why the gate
// goes in now: every figure the tiles would use is already measured and gated
// (`culture_hub_figures.data.test.ts`), so wiring metrics is a copy change away —
// and the funds precedent is that the scenes get drawn long before the numbers
// arrive, then break silently when they do.
//
// SAFE BOX: no `var(--sector)`-filled mark may overlap x < 132 AND y > 72.
// Strokes and PAPER fills may — they sit under the scrim quietly.

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { CULTURE_SCENES } from "./cultureScenes";

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

describe("culture hub scenes", () => {
  it("renders every scene", () => {
    for (const [id, Scene] of Object.entries(CULTURE_SCENES)) {
      const svg = renderToStaticMarkup(createElement(Scene));
      expect(svg, `scene "${id}" rendered nothing`).toContain("<svg");
    }
  });

  it("keeps accent-filled marks out of the metric's corner", () => {
    for (const [id, Scene] of Object.entries(CULTURE_SCENES)) {
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
    const total = Object.values(CULTURE_SCENES).reduce(
      (n, Scene) =>
        n + accentBoxes(renderToStaticMarkup(createElement(Scene))).length,
      0,
    );
    expect(total).toBeGreaterThan(20);
  });
});
