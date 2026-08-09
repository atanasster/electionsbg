// Gates that RENDER the scenes, which is the half `fundsHubRegistry.test.ts` cannot do.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// WHY RENDERING MATTERS. The registry gate proves every tile id has an entry in FUNDS_SCENES.
// It does not prove the entry WORKS: a scene that throws, or that emits `NaN` into a `d`
// attribute from some arithmetic, white-pages the hub in exactly the way a missing scene does
// and passes all eleven of those tests. This file draws each one and reads the result.
//
// THE SAFE BOX is the finding that made this file worth writing. `InfographicTile` overlays a
// `metric` at the banner's bottom-left behind a radial scrim, and its own source says the glow
// is „a safety net, not a licence to draw behind the number". The first cut of `fundsScenes`
// broke that in EIGHT of ten scenes — `absorption` put a solid 180×42 accent block exactly
// where the figure goes — and nothing caught it, because step 7 has not wired the metrics yet.
//
// The sibling registries have the same hole: a review of this step found `parliamentScenes`'
// `Correlation` renders to y=120 in a 116-tall frame and is silently clipped. This gate is
// scoped to the funds scenes; widening it is worth doing and is named in the plan.
// ═══════════════════════════════════════════════════════════════════════════════════════════

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { FUNDS_SCENES } from "./fundsScenes";

/** The frame every scene draws into. */
const W = 300;
const H = 116;

/** No `var(--sector)`-filled mark may overlap this. Strokes and PAPER fills may — they sit
 *  under the scrim quietly; a saturated accent block does not. */
const SAFE_X = 132;
const SAFE_Y = 72;

const markup = (id: string): string =>
  renderToStaticMarkup(createElement(FUNDS_SCENES[id]));

/** Every numeric coordinate the markup mentions, as (attr, value) pairs. */
const coords = (svg: string): { attr: string; v: number }[] => {
  const out: { attr: string; v: number }[] = [];
  for (const m of svg.matchAll(
    /\b(cx|cy|x|y|x1|y1|x2|y2|width|height|r)="([-\d.]+)"/g,
  ))
    out.push({ attr: m[1], v: Number(m[2]) });
  for (const m of svg.matchAll(/\bd="([^"]+)"/g))
    for (const n of m[1].matchAll(/-?\d+(?:\.\d+)?/g))
      out.push({ attr: "d", v: Number(n[0]) });
  return out;
};

/** Accent-filled rects and circles, as bounding boxes. */
const accentBoxes = (svg: string) => {
  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const m of svg.matchAll(/<rect\b[^>]*>/g)) {
    const el = m[0];
    if (!el.includes("var(--sector)")) continue;
    const num = (a: string) =>
      Number(new RegExp(`\\b${a}="([-\\d.]+)"`).exec(el)?.[1] ?? NaN);
    const x = num("x"),
      y = num("y"),
      w = num("width"),
      h = num("height");
    if ([x, y, w, h].some(Number.isNaN)) continue;
    boxes.push({ x0: x, y0: y, x1: x + w, y1: y + h });
  }
  for (const m of svg.matchAll(/<circle\b[^>]*>/g)) {
    const el = m[0];
    if (!el.includes("var(--sector)")) continue;
    const num = (a: string) =>
      Number(new RegExp(`\\b${a}="([-\\d.]+)"`).exec(el)?.[1] ?? NaN);
    const cx = num("cx"),
      cy = num("cy"),
      r = num("r");
    if ([cx, cy, r].some(Number.isNaN)) continue;
    boxes.push({ x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r });
  }
  return boxes;
};

const ids = Object.keys(FUNDS_SCENES);

describe("every scene renders", () => {
  it.each(ids)("%s draws without throwing", (id) => {
    expect(() => markup(id)).not.toThrow();
    expect(markup(id).length).toBeGreaterThan(80);
  });

  it.each(ids)("%s emits no NaN", (id) => {
    // A single NaN in a `d` makes the browser drop the whole path silently — the mark simply is
    // not there, and no error is raised anywhere.
    expect(markup(id)).not.toMatch(/NaN/);
  });
});

describe("every scene stays inside the 300x116 frame", () => {
  it.each(ids)("%s draws nothing outside the viewBox", (id) => {
    const bad = coords(markup(id)).filter(
      (c) =>
        (["cx", "x", "x1", "x2"].includes(c.attr) &&
          (c.v < -8 || c.v > W + 8)) ||
        (["cy", "y", "y1", "y2"].includes(c.attr) && (c.v < -8 || c.v > H + 8)),
    );
    expect(
      bad,
      `${id} draws at ${bad.map((b) => `${b.attr}=${b.v}`).join(", ")} — outside 300x116, so it is silently clipped`,
    ).toEqual([]);
  });
});

describe("the metric's corner stays clear", () => {
  it.each(ids)("%s keeps accent marks out of the bottom-left", (id) => {
    const bad = accentBoxes(markup(id)).filter(
      (b) => b.x0 < SAFE_X && b.y1 > SAFE_Y,
    );
    expect(
      bad,
      `${id} fills accent at x<${SAFE_X} y>${SAFE_Y} (${bad
        .map((b) => `${b.x0},${b.y0}-${b.x1},${b.y1}`)
        .join(" ")}) — that is where InfographicTile draws the metric`,
    ).toEqual([]);
  });

  it("the safe box is not vacuous — a deliberately bad scene trips it", () => {
    // The gate above passes when there are no accent-filled rects at all, so this proves the
    // detector actually sees one in the forbidden corner.
    const offending = `<rect x="10" y="80" width="100" height="30" fill="var(--sector)"></rect>`;
    expect(
      accentBoxes(offending).filter((b) => b.x0 < SAFE_X && b.y1 > SAFE_Y),
    ).toHaveLength(1);
    const fine = `<rect x="140" y="20" width="100" height="30" fill="var(--sector)"></rect>`;
    expect(
      accentBoxes(fine).filter((b) => b.x0 < SAFE_X && b.y1 > SAFE_Y),
    ).toHaveLength(0);
  });
});

describe("scenes are distinct", () => {
  it("no two scenes render identical markup", () => {
    // A copy-pasted scene means two tiles look like the same kind of thing, which is the same
    // failure the unique-accent rule exists to prevent.
    const seen = new Map<string, string>();
    for (const id of ids) {
      const m = markup(id)
        .replace(/id="[^"]*"/g, "")
        .replace(/url\(#[^)]*\)/g, "");
      const prev = seen.get(m);
      expect(prev, `${id} renders identically to ${prev}`).toBeUndefined();
      seen.set(m, id);
    }
  });
});
