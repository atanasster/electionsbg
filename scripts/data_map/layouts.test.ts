// The baked per-view layouts, checked against the committed manifest.
//
// Every failure in this family is silent: a view whose layout was never
// generated falls back to the whole 108-node graph and just looks like the old
// dimming behaviour, and a view whose layout reused the `all` positions renders
// 20 nodes down a 3,684px column — correct content, and none of the collapse
// the layouts exist for. Neither errors, and neither moves a row count.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { DataMapManifest } from "../../src/data/dataMap/useDataMap";
import { DATA_MAP_MARGIN } from "../../src/data/dataMap/viewport";

const ROOT = path.resolve(import.meta.dirname, "../..");
const manifest: DataMapManifest = JSON.parse(
  readFileSync(path.join(ROOT, "data/data_map.json"), "utf8"),
);

const extentOf = (viewId: string) => {
  const layout = manifest.layouts![viewId];
  const box = new Map(manifest.nodes.map((n) => [n.id, n]));
  let w = 0;
  let h = 0;
  for (const p of layout.nodes) {
    const n = box.get(p.id)!;
    w = Math.max(w, p.x + n.w);
    h = Math.max(h, p.y + n.h);
  }
  for (const t of layout.tiers) {
    w = Math.max(w, t.x + t.w);
    h = Math.max(h, t.y + t.h);
  }
  // The margin the SCREEN adds, so these are the numbers the canvas box is
  // sized from rather than a raw union 16px smaller.
  return { w: w + DATA_MAP_MARGIN, h: h + DATA_MAP_MARGIN };
};

// Drives every parameterised arm. `Object.keys(manifest.layouts!)` would run in
// the describe body — during COLLECTION — and throw on a manifest without
// `layouts`, so the suite would report zero results and the clean "is v3 or
// newer" diagnostic would never run.
const layoutIds = Object.keys(manifest.layouts ?? {});

const membersOf = (viewId: string): string[] => {
  const tag = manifest.views.find((v) => v.id === viewId)!.tag;
  return manifest.nodes
    .filter((n) => !tag || n.tags.includes(tag))
    .map((n) => n.id)
    .sort();
};

describe("the manifest bakes one layout per view", () => {
  it("is v3 or newer", () => {
    expect(manifest.version).toBeGreaterThanOrEqual(3);
    expect(manifest.layouts).toBeTruthy();
  });

  it("covers every view, `all` included", () => {
    // `all` is baked too so the client resolver has no special case for it.
    expect(Object.keys(manifest.layouts!).sort()).toEqual(
      manifest.views.map((v) => v.id).sort(),
    );
  });

  it.each(layoutIds)("%s holds exactly its tag's members", (viewId) => {
    expect(manifest.layouts![viewId].nodes.map((n) => n.id).sort()).toEqual(
      membersOf(viewId),
    );
  });

  it("keeps the top-level positions equal to the `all` layout", () => {
    // manifest.nodes[].x/y and manifest.tiers ARE the `all` layout, and a
    // cached v2 copy relies on them. If the two ever diverge, a v2 client and a
    // v3 client draw different maps from the same file.
    const all = new Map(manifest.layouts!.all.nodes.map((n) => [n.id, n]));
    for (const n of manifest.nodes)
      expect({ x: n.x, y: n.y }).toEqual({
        x: all.get(n.id)!.x,
        y: all.get(n.id)!.y,
      });
    expect(manifest.layouts!.all.tiers).toEqual(manifest.tiers);
  });
});

describe("each view's layout is actually re-solved for its subset", () => {
  const smaller = manifest.views
    .filter((v) => v.tag)
    .map((v) => v.id)
    .filter((id) => manifest.layouts![id].nodes.length < manifest.nodes.length);

  it("has views that are genuinely a subset", () => {
    // Guards the arm below against going vacuous if every view ever grew to
    // cover the whole graph.
    expect(smaller.length).toBeGreaterThanOrEqual(5);
  });

  it.each(smaller)("%s is shorter than the full graph", (viewId) => {
    // Measured 2026-09-02 (extents as the screen consumes them, margin
    // included): all is 3,684px tall; prices 422, parliament 579, elections
    // 724, local 968, indicators 1,266, fiscal 2,202.
    expect(extentOf(viewId).h).toBeLessThan(extentOf("all").h);
  });

  it.each(smaller)("%s is re-solved, not merely translated", (viewId) => {
    // THE mutation check, and the arm above is NOT it: `buildViewLayout` copies
    // the members and calls `layout()`, which runs ELK *and* normalises to a
    // top-left origin. The plausible regression is keeping the normalisation
    // and losing the ELK run — that mutant translates the subset upward and is
    // comfortably shorter than `all`, so it passes every height comparison.
    //
    // So compare against that exact mutant: the vertical span the same members
    // occupy at the `all` positions. A translate-only layout scores 1.000 by
    // construction. Measured 2026-09-02 — elections 0.179, prices 0.183,
    // parliament 0.221, local 0.245, indicators 0.546, fiscal 0.728.
    const box = new Map(manifest.nodes.map((n) => [n.id, n]));
    const at = new Map(manifest.layouts!.all.nodes.map((n) => [n.id, n.y]));
    const span = (ys: { id: string; y: number }[]) =>
      Math.max(...ys.map((p) => p.y + box.get(p.id)!.h)) -
      Math.min(...ys.map((p) => p.y));
    const layout = manifest.layouts![viewId];
    const translated = layout.nodes.map((p) => ({
      id: p.id,
      y: at.get(p.id)!,
    }));
    expect(span(layout.nodes) / span(translated)).toBeLessThan(0.8);
  });
});

describe("every layout is well formed", () => {
  it.each(layoutIds)("%s has finite, normalised boxes", (viewId) => {
    const layout = manifest.layouts![viewId];
    for (const p of [...layout.nodes, ...layout.tiers]) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    // Normalised to a small top-left origin, which is what lets the screen
    // size its aspect-ratio box from the extent alone.
    expect(Math.min(...layout.tiers.map((t) => t.x))).toBeGreaterThanOrEqual(0);
    expect(Math.min(...layout.tiers.map((t) => t.y))).toBeGreaterThanOrEqual(0);
  });

  it.each(layoutIds)("%s frames exactly the kinds it contains", (viewId) => {
    // A tier with no members would carry Infinity bounds — `Math.min()` over
    // an empty array — so the generator omits it. This is the generic form of
    // that rule: no missing frame, and no frame for an absent kind.
    const layout = manifest.layouts![viewId];
    const box = new Map(manifest.nodes.map((n) => [n.id, n]));
    const kinds = new Set(layout.nodes.map((p) => box.get(p.id)!.kind));
    expect(new Set(layout.tiers.map((t) => t.kind))).toEqual(kinds);
  });

  it.each(layoutIds)("%s keeps its nodes inside their tier", (viewId) => {
    const layout = manifest.layouts![viewId];
    const box = new Map(manifest.nodes.map((n) => [n.id, n]));
    const frame = new Map(layout.tiers.map((t) => [t.kind, t]));
    for (const p of layout.nodes) {
      const n = box.get(p.id)!;
      const t = frame.get(n.kind)!;
      expect(p.x).toBeGreaterThanOrEqual(t.x);
      expect(p.x + n.w).toBeLessThanOrEqual(t.x + t.w);
      expect(p.y).toBeGreaterThanOrEqual(t.y);
      expect(p.y + n.h).toBeLessThanOrEqual(t.y + t.h);
    }
  });
});
