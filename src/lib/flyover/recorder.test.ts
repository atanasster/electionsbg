import { describe, expect, it } from "vitest";
import { createRecorder } from "./recorder";

describe("the recording context", () => {
  it("records calls and property writes in order", () => {
    // ⚠️ PROPERTY WRITES TOO. `fillStyle` is how every colour decision reaches the canvas, so
    // a log of geometry alone would compare equal between a scene drawn in the price ramp and
    // the same scene drawn flat — which is most of what the render tests assert.
    const rec = createRecorder();
    rec.fillStyle = "#123456";
    rec.beginPath();
    rec.moveTo(1, 2);
    expect(rec.log()).toEqual([
      'set:fillStyle("#123456")',
      "beginPath()",
      "moveTo(1,2)",
    ]);
  });

  it("reads back a property it was given", () => {
    const rec = createRecorder();
    expect(rec.globalAlpha).toBe(1);
    rec.globalAlpha = 0.5;
    expect(rec.globalAlpha).toBe(0.5);
  });

  it("rounds coordinates to a tenth of a pixel before logging", () => {
    // Without it, „the same state twice" is a float-equality test on a chain of trigonometry,
    // and the assertion measures the FPU rather than the renderer.
    const rec = createRecorder();
    rec.moveTo(0.52 + 0.52, 2.06);
    rec.lineTo(-0.04, 3.999);
    expect(rec.log()).toEqual(["moveTo(1,2.1)", "lineTo(0,4)"]);
  });

  it("filters by operation", () => {
    const rec = createRecorder();
    rec.fill();
    rec.stroke();
    rec.fill();
    expect(rec.ops("fill")).toHaveLength(2);
    expect(rec.ops("nope")).toHaveLength(0);
  });

  it("keeps the dash array whole rather than flattening it", () => {
    const rec = createRecorder();
    rec.setLineDash([10, 8]);
    expect(rec.log()).toEqual(["setLineDash([10,8])"]);
  });
});
