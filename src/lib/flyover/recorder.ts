// A `Ctx2D` that records instead of drawing.
//
// It is what makes the renderer testable at all: `render` has to produce the same picture in
// four places — the browser, `@napi-rs/canvas`, Remotion and a test — and only the last of
// them can afford to have no canvas. Comparing two COMMAND LOGS is also a stronger assertion
// than comparing two bitmaps: it fails on the draw that changed rather than on a pixel, and it
// runs in jsdom, where there is no 2D context to get.

import type { Ctx2D } from "./render";

export interface RecordedCall {
  op: string;
  args: (number | string | number[])[];
}

export interface Recorder extends Ctx2D {
  calls: RecordedCall[];
  /** Every call and property write, as comparable strings. */
  log(): string[];
  ops(op: string): RecordedCall[];
}

/**
 * ⚠️ PROPERTY WRITES ARE RECORDED TOO, and they have to be: `fillStyle` is how every colour
 * decision reaches the canvas, so a log of geometry alone would compare equal between a scene
 * drawn in the price ramp and the same scene drawn flat.
 */
export const createRecorder = (): Recorder => {
  const calls: RecordedCall[] = [];
  const push = (op: string, ...args: (number | string | number[])[]) => {
    calls.push({ op, args });
  };
  const state: Record<string, string | number | number[]> = {};
  const prop = (name: string, initial: string | number) => {
    state[name] = initial;
    return {
      get: () => state[name],
      set: (v: string | number) => {
        state[name] = v;
        push(`set:${name}`, v);
      },
    };
  };

  const rec = {
    calls,
    log: () =>
      calls.map(
        (c) => `${c.op}(${c.args.map((a) => JSON.stringify(a)).join(",")})`,
      ),
    ops: (op: string) => calls.filter((c) => c.op === op),
    save: () => push("save"),
    restore: () => push("restore"),
    beginPath: () => push("beginPath"),
    moveTo: (x: number, y: number) => push("moveTo", r(x), r(y)),
    lineTo: (x: number, y: number) => push("lineTo", r(x), r(y)),
    quadraticCurveTo: (cx: number, cy: number, x: number, y: number) =>
      push("quadraticCurveTo", r(cx), r(cy), r(x), r(y)),
    closePath: () => push("closePath"),
    fill: () => push("fill"),
    stroke: () => push("stroke"),
    clearRect: (x: number, y: number, w: number, h: number) =>
      push("clearRect", r(x), r(y), r(w), r(h)),
    fillRect: (x: number, y: number, w: number, h: number) =>
      push("fillRect", r(x), r(y), r(w), r(h)),
    fillText: (t: string, x: number, y: number) =>
      push("fillText", t, r(x), r(y)),
    strokeText: (t: string, x: number, y: number) =>
      push("strokeText", t, r(x), r(y)),
    setLineDash: (segments: number[]) => push("setLineDash", segments),
  } as unknown as Recorder;

  for (const [name, initial] of [
    ["fillStyle", "#000000"],
    ["strokeStyle", "#000000"],
    ["lineWidth", 1],
    ["lineJoin", "miter"],
    ["lineCap", "butt"],
    ["globalAlpha", 1],
    ["font", "10px sans-serif"],
    ["textAlign", "start"],
    ["textBaseline", "alphabetic"],
    ["lineDashOffset", 0],
  ] as [string, string | number][]) {
    Object.defineProperty(rec, name, {
      ...prop(name, initial),
      enumerable: true,
      configurable: true,
    });
  }
  return rec;
};

/**
 * Round to a tenth of a pixel before logging.
 *
 * ⚠️ Without it a „same state twice" comparison is a float-equality test on a chain of
 * trigonometry, and the assertion would be measuring the FPU rather than the renderer.
 */
const r = (n: number): number => Math.round(n * 10) / 10;
