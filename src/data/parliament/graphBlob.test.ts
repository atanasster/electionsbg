// The connections matrix's colour denominator.
//
// Extracted from the component so the rule can be tested: the heatmap is 120 lines of JSX
// inside a 720-line screen, and this is the one line in it that decides whether „Мост между
// групи" is a chart about bridges or a chart about how big each group is.

import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { offDiagonalMax } from "./graphBlob";

/** The real facet matrix, as /connections renders it today. */
const AXES = ["politician", "exec", "magistrate", "public"];
const M: Record<string, number> = {
  "politician|politician": 1068,
  "politician|exec": 358,
  "politician|magistrate": 34,
  "politician|public": 193,
  "exec|exec": 302,
  "exec|magistrate": 8,
  "exec|public": 55,
  "magistrate|magistrate": 3,
  "magistrate|public": 3,
  "public|public": 43,
};
const get = (a: string, b: string): number =>
  M[[a, b].sort().join("|")] ?? M[`${a}|${b}`] ?? 0;

describe("offDiagonalMax", () => {
  test("ignores the diagonal, which is three times the largest bridge", () => {
    // 1,068 self-ties against a 358 bridge. Scaling on the diagonal is what washed every
    // cross-group cell out under a heading about bridges.
    assert.equal(offDiagonalMax(AXES, get), 358);
  });

  test("is 0 when there is nothing off-diagonal to scale by", () => {
    // A single-axis matrix, and a matrix whose groups touch nothing outside themselves.
    // Both are "draw nothing", and both would divide by log(1) without the caller's guard.
    assert.equal(offDiagonalMax(["politician"], get), 0);
    assert.equal(
      offDiagonalMax(["a", "b"], (x, y) => (x === y ? 99 : 0)),
      0,
    );
  });

  test("is symmetric — either triangle gives the same answer", () => {
    // cellKey canonicalises on a <= b, so the upper half is the lower half mirrored. That
    // is what makes rendering one triangle lossless rather than a crop.
    const flipped = (a: string, b: string) => get(b, a);
    assert.equal(offDiagonalMax(AXES, flipped), offDiagonalMax(AXES, get));
  });
});
