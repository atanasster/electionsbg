import { describe, expect, it } from "vitest";
import {
  COLUMN_MAX_H,
  TOP_FLOWS,
  TOP_FLOWS_NARROW,
  arcColor,
  arcLift,
  arcWidth,
  columnHeight,
  flowsTouching,
  layerMax,
  mixHex,
  priceColor,
  topFlows,
} from "./layers";
import { TEST_PALETTE, TEST_WORLD } from "./testWorld";

describe("columnHeight", () => {
  it("scales by the square root, not linearly", () => {
    // Linear heights put Sofia at 150 px and Видин at 1.4 — a column a reader cannot see is a
    // claim that Видин buys nothing.
    expect(columnHeight(100, 100)).toBe(COLUMN_MAX_H);
    expect(columnHeight(25, 100)).toBeCloseTo(COLUMN_MAX_H / 2, 6);
    // Mutation check: the linear form would put a quarter-sized value at a quarter height.
    expect(columnHeight(25, 100)).toBeGreaterThan(COLUMN_MAX_H / 4);
  });

  it("keeps the smallest oblast visible against the real spread", () => {
    const max = layerMax(TEST_WORLD, "all", "proc");
    const smallest = TEST_WORLD.layers.all.proc!.VAR;
    // Sofia dominates procurement ~17:1 in this fixture; the root has to keep Варна drawable.
    expect(columnHeight(smallest, max)).toBeGreaterThan(20);
  });

  it("returns zero rather than NaN on the degenerate inputs", () => {
    for (const [v, m] of [
      [0, 100],
      [10, 0],
      [-5, 100],
      [Number.NaN, 100],
      [10, Number.NaN],
    ]) {
      expect(columnHeight(v, m)).toBe(0);
    }
  });
});

describe("layerMax", () => {
  it("is per layer, never shared", () => {
    // One shared maximum would draw the agri layer — whose whole point is that the
    // countryside inverts the map — as 28 invisible stubs beside procurement.
    expect(layerMax(TEST_WORLD, "all", "proc")).toBe(52709);
    expect(layerMax(TEST_WORLD, "all", "agri")).toBe(819);
    expect(layerMax(TEST_WORLD, "all", "proc")).toBeGreaterThan(
      layerMax(TEST_WORLD, "all", "agri") * 50,
    );
  });

  it("is zero for a scope or layer the artifact does not carry", () => {
    expect(layerMax(TEST_WORLD, "ns:2026_04_19", "agri")).toBe(0);
    expect(layerMax(TEST_WORLD, "y:2024", "proc")).toBe(0);
  });
});

describe("topFlows", () => {
  it("excludes the diagonal, which is the largest quantity in the matrix", () => {
    // 55.7% of the placed money stays inside the buyer's own oblast. An arc from a point to
    // itself is not a small arc, it is nothing — so that share is a caption, never a curve.
    const flows = topFlows(TEST_WORLD);
    expect(flows.every((f) => f.from !== f.to)).toBe(true);
    // The fixture's diagonal holds the two largest cells (4000 and 500); neither is drawn.
    expect(flows[0]).toEqual({ from: "PDV", to: "SOF", eur: 1116 });
    expect(flows.some((f) => f.eur === 4000)).toBe(false);
  });

  it("is ordered by money and honours its limit", () => {
    const flows = topFlows(TEST_WORLD);
    for (let i = 1; i < flows.length; i++) {
      expect(flows[i].eur).toBeLessThanOrEqual(flows[i - 1].eur);
    }
    expect(topFlows(TEST_WORLD, 2)).toHaveLength(2);
    expect(topFlows(TEST_WORLD, 0)).toHaveLength(0);
    expect(TOP_FLOWS).toBeGreaterThan(0);
    // The narrow-viewport count is the host's, and it must stay a NARROWING — a host that
    // hard-codes its own number is what this constant exists to prevent.
    expect(TOP_FLOWS_NARROW).toBeLessThan(TOP_FLOWS);
    expect(TOP_FLOWS_NARROW).toBeGreaterThan(0);
  });

  it("breaks a money tie on (from, to), the same way in every runtime", () => {
    // ⚠️ A HAND-WRITTEN EXPECTED ORDER, not a second call. Comparing a pure function to its
    // own output can only fail on Math.random or a clock — it never exercises the tiebreak.
    // And the tiebreak decides which arcs survive `slice(0, 40)` in a matrix stored in whole
    // M€, where small cells repeat: a comparator returning 1 in both directions leaves that to
    // the JS engine, so Chrome, Safari and the poster renderer could disagree about which
    // flows exist.
    const world = structuredClone(TEST_WORLD);
    world.flows.m = [
      [0, 100, 100],
      [100, 0, 100],
      [100, 100, 0],
    ];
    expect(topFlows(world).map((f) => `${f.from}>${f.to}`)).toEqual([
      "PDV>SOF",
      "PDV>VAR",
      "SOF>PDV",
      "SOF>VAR",
      "VAR>PDV",
      "VAR>SOF",
    ]);
    // Mutation check: with only `from` as the tiebreak, two flows out of one buyer compare
    // equal in both directions — which is the ordering the runtime then decides.
    const a = { from: "PDV", to: "SOF", eur: 100 };
    const b = { from: "PDV", to: "VAR", eur: 100 };
    const fromOnly = (x: typeof a, y: typeof a) =>
      y.eur - x.eur || (x.from < y.from ? -1 : 1);
    expect(fromOnly(a, b)).toBe(fromOnly(b, a));
  });
});

describe("flowsTouching", () => {
  it("returns both directions for one oblast", () => {
    const flows = flowsTouching(TEST_WORLD, "SOF");
    expect(flows.some((f) => f.to === "SOF")).toBe(true);
    expect(flows.some((f) => f.from === "SOF")).toBe(true);
    expect(flows.every((f) => f.from === "SOF" || f.to === "SOF")).toBe(true);
    expect(flows.every((f) => f.from !== f.to)).toBe(true);
  });

  it("is empty for an oblast the matrix does not carry", () => {
    expect(flowsTouching(TEST_WORLD, "VID")).toEqual([]);
  });
});

describe("arc geometry and colour", () => {
  it("widens with the square root of the money", () => {
    expect(arcWidth(100, 100)).toBeGreaterThan(arcWidth(10, 100));
    expect(arcWidth(10, 100) / arcWidth(100, 100)).toBeGreaterThan(0.3);
    expect(arcWidth(0, 100)).toBe(0);
    expect(arcWidth(10, 0)).toBe(0);
  });

  it("lifts in proportion to the span, and caps", () => {
    expect(arcLift(0, 0)).toBeLessThan(arcLift(300, 0));
    expect(arcLift(100000, 0)).toBeLessThanOrEqual(200);
  });

  it("colours by direction relative to the capital", () => {
    // 31.1% flows INTO Sofia and 7.3% out — the two directions are the finding, so they are
    // the two colours, and everything else is neutral rather than a third opinion.
    expect(arcColor({ from: "PDV", to: "SOF", eur: 1 }, TEST_PALETTE)).toBe(
      TEST_PALETTE.arcIn,
    );
    expect(arcColor({ from: "SOF", to: "VAR", eur: 1 }, TEST_PALETTE)).toBe(
      TEST_PALETTE.arcOut,
    );
    expect(arcColor({ from: "PDV", to: "VAR", eur: 1 }, TEST_PALETTE)).toBe(
      TEST_PALETTE.arcNeutral,
    );
  });
});

describe("mixHex", () => {
  it("is the identity at both ends and mixes between", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("expands the three-digit form", () => {
    expect(mixHex("#fff", "#fff", 0.5)).toBe("#ffffff");
    expect(mixHex("f00", "f00", 0)).toBe("#ff0000");
  });

  it("collapses to an endpoint for a non-hex palette — the documented cost", () => {
    // ⚠️ THIS IS WHY `FlyoverPalette` REQUIRES HEX. This repo's CSS variables hold bare HSL
    // triples (`--background: 39 33% 92%`) and `getComputedStyle` returns `rgb(…)`; neither
    // parses, so a browser host that forwards them un-converted gets flat columns, a
    // posterised price ramp and a hard-cut election fade at once, at a 200. A fabricated
    // #000000 would look chosen, so the nearer end is returned instead.
    expect(mixHex("oklch(0.7 0.1 250)", "#ffffff", 0.2)).toBe(
      "oklch(0.7 0.1 250)",
    );
    expect(mixHex("oklch(0.7 0.1 250)", "#ffffff", 0.8)).toBe("#ffffff");
    expect(mixHex("39 33% 92%", "#000000", 0.28)).toBe("39 33% 92%");
    expect(mixHex("hsl(39 33% 92%)", "#000000", 0.28)).toBe("hsl(39 33% 92%)");
    expect(mixHex("rgb(232, 238, 243)", "#000000", 0.28)).toBe(
      "rgb(232, 238, 243)",
    );
  });
});

describe("priceColor", () => {
  it("diverges around 100, which is the baseline day", () => {
    // The index is „100 = 2 January 2026". A sequential ramp anchored at zero would render a
    // 2% fall and a 2% rise as almost the same colour, which is the whole content of the layer.
    expect(priceColor(100, TEST_PALETTE)).toBe(TEST_PALETTE.land);
    expect(priceColor(96, TEST_PALETTE)).toBe(TEST_PALETTE.priceDown);
    expect(priceColor(104, TEST_PALETTE)).toBe(TEST_PALETTE.priceUp);
    expect(priceColor(98, TEST_PALETTE)).not.toBe(
      priceColor(102, TEST_PALETTE),
    );
  });

  it("clamps beyond the span rather than running off the ramp", () => {
    expect(priceColor(50, TEST_PALETTE)).toBe(TEST_PALETTE.priceDown);
    expect(priceColor(200, TEST_PALETTE)).toBe(TEST_PALETTE.priceUp);
  });
});
