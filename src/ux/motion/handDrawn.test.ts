import { describe, expect, it } from "vitest";
import { handDrawnLoopPath, handDrawnUnderlinePath } from "./handDrawn";

const coords = (d: string) =>
  [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));

describe("handDrawnLoopPath", () => {
  it("is deterministic for a seed — the same mark on every render", () => {
    expect(handDrawnLoopPath(10, 10, 20, 12, "SOF")).toBe(
      handDrawnLoopPath(10, 10, 20, 12, "SOF"),
    );
  });

  it("differs between seeds, so two marks on one map are not clones", () => {
    expect(handDrawnLoopPath(10, 10, 20, 12, "SOF")).not.toBe(
      handDrawnLoopPath(10, 10, 20, 12, "VAR"),
    );
  });

  it("stays close to the requested ellipse", () => {
    const xs = coords(handDrawnLoopPath(50, 40, 20, 10, "x"));
    for (const v of xs) expect(Number.isFinite(v)).toBe(true);
    const pts: [number, number][] = [];
    for (let i = 0; i < xs.length; i += 2) pts.push([xs[i], xs[i + 1]]);
    for (const [x, y] of pts) {
      expect(Math.abs(x - 50)).toBeLessThan(20 * 1.4);
      expect(Math.abs(y - 40)).toBeLessThan(10 * 1.4);
    }
  });
});

describe("handDrawnUnderlinePath", () => {
  it("is deterministic per seed and differs between seeds", () => {
    expect(handDrawnUnderlinePath("a")).toBe(handDrawnUnderlinePath("a"));
    expect(handDrawnUnderlinePath("a")).not.toBe(handDrawnUnderlinePath("b"));
  });

  it("spans the box, overshooting a little, and stays inside its height", () => {
    const nums = [
      ...handDrawnUnderlinePath("x").matchAll(/-?\d+(?:\.\d+)?/g),
    ].map((m) => Number(m[0]));
    const xs = nums.filter((_, i) => i % 2 === 0);
    const ys = nums.filter((_, i) => i % 2 === 1);
    expect(Math.min(...xs)).toBeLessThan(0);
    expect(Math.max(...xs)).toBeGreaterThan(100);
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(10);
    }
  });
});
