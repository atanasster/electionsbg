// CameraDirector's own rules, plus the React Flow mechanic it rests on — the
// same static-analysis shape as lateralHandles.test.ts in this directory, and
// for the same reason: every failure in this class is invisible in review and
// produces no error at runtime. A double-framed fit button ends on the CORRECT
// transform, so it survives casual testing indefinitely; an animated first
// frame is just "the page feels odd"; a dropped node in a focus frame is a
// camera that quietly shows a subset of the closure.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const canvas = () => read("src/screens/components/datamap/DataMapCanvas.tsx");

describe("the fit control is ours, not React Flow's", () => {
  it("does not import React Flow's own Controls component", () => {
    // @xyflow/react Controls:
    //   const onFitViewHandler = () => { fitView(fitViewOptions); onFitView?.(); }
    // The handler is ADDITIVE. Upstream's fitView cannot frame this graph at
    // MOUNT (that is the #004 bug viewport.ts exists for) but it CAN once the
    // nodes have painted, which is any time a user could click — so leaving the
    // default button on and passing `onFitView` framed twice per click: an
    // instant snap to upstream's padding 0.1 / maxZoom 2, then a 300ms
    // animation to ours. Measured at a 1008px pane: 6.8% zoom pop, 109px jump.
    // Docking React Flow's own Controls also sinks the buttons to the bottom
    // of the ~4,200px tall canvas box, which is what DataMapFloatingControls
    // (portaled to document.body, position: fixed) replaced it to fix — so
    // this now asserts the import is absent outright, not merely disarmed.
    const src = canvas();
    const importBlock =
      src.match(/import\s*\{[\s\S]*?\}\s*from\s*"@xyflow\/react"/)?.[0] ?? "";
    expect(importBlock).not.toMatch(/\bControls\b/);
    expect(importBlock).not.toMatch(/\bControlButton\b/);
  });

  it("does not hand React Flow a fit handler that would run after its own", () => {
    expect(canvas()).not.toMatch(/onFitView=/);
  });

  it("labels the replacement fit button", () => {
    // The floating fit button takes its accessible name from `fitLabel`
    // explicitly — a bare icon button would ship unlabelled.
    const src = canvas();
    expect(src).toMatch(/onClick=\{onReframe\}[\s\S]*?aria-label=\{fitLabel\}/);
    expect(src).toMatch(/onClick=\{onReframe\}[\s\S]*?title=\{fitLabel\}/);
  });

  it("drops the fitView props that would compete with the director", () => {
    // CameraDirector is the only thing that may set the viewport; React Flow's
    // own `fitView` prop would apply a DIFFERENT framing on init.
    const src = canvas();
    expect(src).not.toMatch(/^\s*fitView$/m);
    expect(src).not.toMatch(/fitViewOptions=/);
  });
});

describe("CameraDirector framing rules", () => {
  it("does not animate the first framing", () => {
    // Otherwise the graph swoops in from the identity transform on every load.
    expect(canvas()).toMatch(/framed\.current \? \(focus \? 500 : 300\) : 0/);
  });

  it("reads focus ids from the array, not from the joined key", () => {
    // `focusKey` is the effect's DEPENDENCY (a stable string beats an array
    // rebuilt every render). Splitting it back into ids would drop any node
    // whose id contains the delimiter — silently, since the miss is filtered
    // out and the camera just frames a subset. 0 of 108 ids carry a comma
    // today, so the failure is latent rather than live.
    const src = canvas();
    expect(src).not.toMatch(/focusKey\s*\n?\s*\.split\(/);
    expect(src).not.toMatch(/focusKey\.split\(/);
    expect(src).toMatch(
      /focusList\s*\n?\s*\.map\(\(id\) => boxById\.get\(id\)\)/,
    );
  });

  it("zooms to a selection only on a narrow pane", () => {
    // On desktop the camera stays still during selection — dimming and arrows
    // carry the lineage, and the page scroll is what walks the reader along the
    // map. `narrow` gating the focus list is what keeps that true.
    expect(canvas()).toMatch(/narrow \? focusIds : \[\]/);
  });

  it("warns rather than silently leaving the graph unframed", () => {
    // The director's early returns are now the whole failure surface: an
    // unmeasured pane leaves the identity transform, i.e. bit-for-bit the bug
    // this replaced, with nothing in the console and nothing failing.
    expect(canvas()).toMatch(
      /import\.meta\.env\.DEV[\s\S]{0,200}graph unframed/,
    );
  });
});
