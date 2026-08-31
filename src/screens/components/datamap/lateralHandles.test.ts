// Two React Flow mechanics that this feature depends on, both invisible in
// review and both verified against the installed @xyflow/system source. Static
// checks, because the failure is a silently-unrendered edge: React Flow's
// getEdgePosition returns null and calls onError('008'), which the canvas does
// not surface, so nothing appears and nothing is logged.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

describe("lateral link rendering depends on two React Flow mechanics", () => {
  it("sets ConnectionMode.Loose", () => {
    // @xyflow/system getEdgePosition:
    //   params.connectionMode === ConnectionMode.Strict
    //     ? targetHandleBounds?.target ?? []
    //     : (target ?? []).concat(source ?? [])
    //   if (!sourceHandle || !targetHandle) return null;
    // The lateral handles are type="source" (a link is undirected), so under
    // the default Strict every lateral edge resolves to null and paints
    // nothing. Measured before the fix: 182 lineage edges, 0 lateral, 72
    // lat-* handles in the DOM, no console warning.
    const canvas = read("src/screens/components/datamap/DataMapCanvas.tsx");
    expect(canvas).toMatch(/connectionMode=\{ConnectionMode\.Loose\}/);
  });

  it("renders the Right source handle BEFORE the lateral pair", () => {
    // getHandle: `!handleId ? bounds[0] : bounds.find(...)`, and handleBounds
    // .source is querySelectorAll(".source") in DOM order. A lineage edge sets
    // no sourceHandle, so it takes source[0]. With lat-t first, all 108
    // dataset→feature edges left from the card's top-centre instead of its
    // right edge — a silent regression on the pre-existing layer.
    const card = read("src/screens/components/datamap/DataMapNodeCard.tsx");
    const right = card.indexOf("Position.Right");
    const top = card.indexOf("Position.Top");
    const bottom = card.indexOf("Position.Bottom");
    expect(right).toBeGreaterThan(0);
    expect(top).toBeGreaterThan(right);
    expect(bottom).toBeGreaterThan(right);
  });

  it("keeps the lateral handles on dataset cards only", () => {
    // Source and feature cards have no lateral links, and an extra source
    // handle on them would shift their lineage edges the same way.
    const card = read("src/screens/components/datamap/DataMapNodeCard.tsx");
    expect(card).toMatch(/node\.kind === "dataset" && \(/);
  });
});
