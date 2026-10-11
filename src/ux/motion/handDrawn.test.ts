import { describe, expect, it } from "vitest";
import { handDrawnLoopPath } from "./handDrawn";

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
      expect(Math.abs(y - 40)).toBeLessThan(20 * 1.4);
    }
  });
});
