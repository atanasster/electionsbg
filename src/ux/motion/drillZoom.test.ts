import { describe, expect, it } from "vitest";
import { drillTransform, MAX_DRILL_SCALE } from "./drillZoom";

const parse = (t: string) => {
  const m = t.match(
    /^translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)$/,
  )!;
  return { tx: +m[1], ty: +m[2], s: +m[3] };
};

describe("drillTransform", () => {
  it("centres the region in the frame", () => {
    const t = parse(
      drillTransform({ x: 100, y: 50, width: 100, height: 100 }, 800, 600)!,
    );
    // The box centre (150, 100) must land on the frame centre (400, 300).
    expect(t.tx + t.s * 150).toBeCloseTo(400, 1);
    expect(t.ty + t.s * 100).toBeCloseTo(300, 1);
  });

  it("fits the tighter axis with a margin", () => {
    const t = parse(
      drillTransform({ x: 0, y: 0, width: 400, height: 100 }, 800, 600)!,
    );
    expect(t.s).toBeCloseTo(0.85 * 2, 2); // width-bound: 800 / 400
  });

  it("never magnifies past the cap — a tiny region does not become a blur", () => {
    const t = parse(
      drillTransform({ x: 10, y: 10, width: 2, height: 2 }, 800, 600)!,
    );
    expect(t.s).toBe(MAX_DRILL_SCALE);
  });

  it("refuses a degenerate box or frame", () => {
    expect(
      drillTransform({ x: 0, y: 0, width: 0, height: 10 }, 800, 600),
    ).toBeNull();
    expect(
      drillTransform({ x: 0, y: 0, width: 10, height: 10 }, 0, 600),
    ).toBeNull();
  });
});
