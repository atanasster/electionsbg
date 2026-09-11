import { expect, it } from "vitest";
import { distribution } from "./latency";
it("uses an even-sample median and nearest-rank p95", () =>
  expect(distribution([4, 1, 3, 2])).toEqual({
    n: 4,
    medianMs: 2.5,
    p95Ms: 4,
    maxMs: 4,
  }));
it("does not invent measurements for an empty group", () =>
  expect(distribution([])).toEqual({
    n: 0,
    medianMs: null,
    p95Ms: null,
    maxMs: null,
  }));
it("rejects invalid elapsed times", () => {
  expect(() => distribution([-1])).toThrow();
  expect(() => distribution([NaN])).toThrow();
});
