// Gates that RENDER the /subsidies scenes — the half `subsidiesRegistry.test.ts` cannot do.
//
// A registry gate proves every tile id has an entry in SUBSIDIES_SCENES. It does not prove the
// entry WORKS: a scene that throws, or that emits `NaN` into a `d` from some arithmetic,
// white-pages the hub exactly as a missing scene does and passes every one of those checks.
// This file draws each one and reads the result.
//
// THE SAFE BOX is why the file is worth its length. `InfographicTile` overlays the `metric`
// large at the banner's bottom-left behind a radial scrim, and its own source calls that glow
// „a safety net, not a licence to draw behind the number". The sibling `fundsScenes` broke it
// in EIGHT of ten — one scene put a solid 180x42 accent block exactly where the figure goes —
// and nothing caught it, because the metrics had not been wired yet. Here they are wired in the
// same commit, so a violation is visible on the page from day one; the gate is what keeps it
// visible after the next edit.
//
// Same three rules as the funds gate, deliberately: renders, stays in frame, keeps the corner
// clear — plus distinctness, since a copy-pasted scene makes two tiles read as the same kind of
// thing, which is the failure the unique-accent rule exists to prevent.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { SUBSIDIES_SCENES } from "./subsidiesScenes";

/** The frame every scene draws into. */
const W = 300;
const H = 116;

/** No `var(--sector)`-filled mark may overlap this. Strokes and PAPER fills may — they sit
 *  under the scrim quietly; a saturated accent block does not. */
const SAFE_X = 132;
const SAFE_Y = 72;

const markup = (id: string): string =>
  renderToStaticMarkup(createElement(SUBSIDIES_SCENES[id]));

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

/** Accent fills the bounding-box detector above does NOT understand. `accentBoxes` reads
 *  <rect> and <circle> only, so a `<path fill="var(--sector)">` in the bottom-left would ship
 *  green — and this scene set has exactly one accent-filled path (political's intersection
 *  lens). Rather than approximate a path's bbox, the rule is: don't use one. A future author
 *  who needs a filled path must widen `accentBoxes` first, which is the point. */
const UNSEEABLE_ACCENT_FILL =
  /<(path|polygon|polyline|ellipse)\b[^>]*fill="var\(--sector\)"/;

/** Every numeric extent a mark actually occupies — rect corners, circle bounds, and the raw
 *  token stream of `d`/`points`. The first cut tested raw ATTRIBUTES, so `x=290 width=100`
 *  passed (only 290 was read) and path-only scenes were not frame-checked at all. */
const extents = (svg: string): { x: number; y: number }[] => {
  const pts: { x: number; y: number }[] = [];
  const num = (el: string, a: string) =>
    Number(new RegExp(`\\b${a}="([-\\d.]+)"`).exec(el)?.[1] ?? NaN);
  for (const m of svg.matchAll(/<rect\b[^>]*>/g)) {
    const x = num(m[0], "x"),
      y = num(m[0], "y"),
      w = num(m[0], "width"),
      h = num(m[0], "height");
    if ([x, y, w, h].some(Number.isNaN)) continue;
    pts.push({ x, y }, { x: x + w, y: y + h });
  }
  for (const m of svg.matchAll(/<circle\b[^>]*>/g)) {
    const cx = num(m[0], "cx"),
      cy = num(m[0], "cy"),
      r = num(m[0], "r");
    if ([cx, cy, r].some(Number.isNaN)) continue;
    pts.push({ x: cx - r, y: cy - r }, { x: cx + r, y: cy + r });
  }
  for (const m of svg.matchAll(/<line\b[^>]*>/g))
    pts.push(
      { x: num(m[0], "x1"), y: num(m[0], "y1") },
      { x: num(m[0], "x2"), y: num(m[0], "y2") },
    );
  // Paths: alternate x/y over the token stream. Sound only because no `d` here contains an
  // ARC — `A rx ry rot large-arc sweep x y` interleaves five non-coordinates into the stream
  // and pairs them as points (the political lens read as y=212 in a 116-tall frame). The
  // no-arcs rule is asserted separately below rather than worked around here.
  for (const m of svg.matchAll(/\bd="([^"]+)"/g)) {
    const n = [...m[1].matchAll(/-?\d+(?:\.\d+)?/g)].map((x) => Number(x[0]));
    for (let i = 0; i + 1 < n.length; i += 2)
      pts.push({ x: n[i], y: n[i + 1] });
  }
  return pts.filter((p) => !Number.isNaN(p.x) && !Number.isNaN(p.y));
};

const ids = Object.keys(SUBSIDIES_SCENES);

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
    const bad = extents(markup(id)).filter(
      (p) => p.x < -8 || p.x > W + 8 || p.y < -8 || p.y > H + 8,
    );
    expect(
      bad,
      `${id} reaches ${bad.map((b) => `${b.x},${b.y}`).join(" ")} — outside 300x116, so it is silently clipped`,
    ).toEqual([]);
  });

  it("the frame check reads EXTENTS, not raw attributes", () => {
    // The first cut tested `x`/`y` only, so a rect starting inside the frame and running out
    // of it passed. Proven here rather than assumed.
    const overflowing = `<rect x="260" y="20" width="60" height="30"></rect>`;
    expect(extents(overflowing).filter((p) => p.x > W + 8)).toHaveLength(1);
    const pathOut = `<path d="M10 10 L 400 200"></path>`;
    expect(
      extents(pathOut).filter((p) => p.x > W + 8 || p.y > H + 8),
    ).toHaveLength(1);
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

  it.each(ids)(
    "%s uses no arc command, which the extent reader cannot parse",
    (id) => {
      expect(
        /\bd="[^"]*[Aa][\s\d]/.test(markup(id)),
        `${id} uses an arc in a path. \`extents\` pairs the token stream as x/y, and an arc's ` +
          `rx/ry/rotation/flags are not coordinates — the frame check would be nonsense. Draw ` +
          `it with a clipPath over circles (see the political scene) or teach extents to parse arcs.`,
      ).toBe(false);
    },
  );

  it.each(ids)("%s uses no accent fill the detector cannot see", (id) => {
    // See UNSEEABLE_ACCENT_FILL. `accentBoxes` reads rect/circle only, so an accent-filled
    // path or polygon is exempt from the safe box by accident. The political scene's lens was
    // exactly that — inside the safe area, but by luck rather than by gate.
    expect(
      UNSEEABLE_ACCENT_FILL.test(markup(id)),
      `${id} fills a path/polygon with var(--sector); accentBoxes cannot bound it, so the ` +
        `safe box does not cover it. Use a rect/circle, or widen the detector first.`,
    ).toBe(false);
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
