// The TypeScript bucketing reproduces the Python one, case for case.
//
// ⚠️ THE VECTORS ARE COMPUTED BY PYTHON, not by this file. That is what makes
// this a cross-language gate rather than a restatement: a hand-edit to the
// generated `sentimentScale.ts` cannot satisfy a fixture produced by the
// producer's own implementation. Regenerate both with
// `python3 news/scripts/gen_bucket_ts.py`.

import { describe, it, expect } from "vitest";
import vectors from "./sentimentScale.vectors.json";
import {
  BUCKET_EDGES,
  EDGE_TOLERANCE,
  LEANING_BUCKET_ORDER,
  RUSSIA_BUCKET_ORDER,
  TONE_BUCKET_ORDER,
  bucketIndex,
  bucketLabel,
  extentFor,
  normalizeValue,
} from "./sentimentScale";
import { LEANING_ORDER, RUSSIA_ORDER, TONE_META } from "./labels";

describe("sentimentScale", () => {
  it("reproduces every Python-computed vector", () => {
    expect(vectors.cases.length).toBeGreaterThan(100);
    const wrong = vectors.cases.filter(
      (c) => bucketIndex(c.value, c.levels) !== c.bucket,
    );
    expect(wrong).toEqual([]);
  });

  it("agrees with Python on the normalized value, exactly", () => {
    // Exact, not approximate: both sides compute `value / ((levels - 1) / 2)`
    // on IEEE-754 doubles from a literal JSON double, so any difference is a
    // different formula rather than rounding — and a tolerance would hide it.
    for (const c of vectors.cases) {
      expect(normalizeValue(c.value, c.levels)).toBe(c.normalized);
    }
  });

  it("carries the same edges and tolerance the producer uses", () => {
    expect([...BUCKET_EDGES]).toEqual(vectors.edges);
    expect(EDGE_TOLERANCE).toBe(vectors.edge_tolerance);
  });

  it("is symmetric under negation, including near an edge", () => {
    // The failure this rule actually had: a one-sided float tolerance, so a
    // value a few ULPs below +0.25 was pulled up while its exact negation was
    // not pulled down. Two opposite articles, non-opposite labels.
    //
    // ⚠️ The probes are rebuilt here rather than read from the fixture, and
    // that duplication is deliberate: this is a PROPERTY the implementation
    // must hold everywhere, checked independently of whichever cases Python
    // happened to emit. The fixture proves agreement; this proves symmetry.
    const last = BUCKET_EDGES.length;
    const probes: number[] = [];
    for (let h = -100; h <= 100; h += 1) probes.push(h / 100);
    for (const edge of BUCKET_EDGES) {
      for (const eps of [0, 1e-16, 1e-13, 1e-10, 1e-8]) {
        probes.push(edge + eps, edge - eps);
      }
    }
    for (const levels of [5, 9]) {
      for (const n of probes) {
        const v = n * extentFor(levels);
        expect(bucketIndex(v, levels)).toBe(last - bucketIndex(-v, levels));
      }
    }
  });

  it("buckets a 9-anchor value the same as its 5-anchor twin", () => {
    for (const fraction of [-1, -0.8, -0.3, 0, 0.3, 0.8, 1]) {
      expect(bucketIndex(fraction * extentFor(5), 5)).toBe(
        bucketIndex(fraction * extentFor(9), 9),
      );
    }
  });

  it("names the bucket, and refuses a vocabulary of the wrong size", () => {
    expect(bucketLabel(-2, 5, TONE_BUCKET_ORDER)).toBe("strongly_unfavorable");
    expect(bucketLabel(0, 5, TONE_BUCKET_ORDER)).toBe("neutral");
    expect(bucketLabel(2, 5, TONE_BUCKET_ORDER)).toBe("strongly_favorable");
    expect(() => bucketLabel(0, 5, ["a", "b", "c"] as const)).toThrow();
  });

  it("takes the anchor count from the VALUE's scale, not the vocabulary", () => {
    // ⚠️ The divergence this signature exists to prevent. A 9-anchor value of
    // +2 is half the range — `favorable`. Inferring the count from the 5-entry
    // display vocabulary normalizes it by 2 instead of 4 and names
    // `strongly_favorable`: a label one bucket too strong, on a named subject,
    // at a 200. Python's `bucket_label` refuses the call outright instead.
    expect(bucketLabel(2, 9, TONE_BUCKET_ORDER)).toBe("favorable");
    expect(bucketLabel(2, 5, TONE_BUCKET_ORDER)).toBe("strongly_favorable");
  });

  it("names every fixture case's bucket, on both anchor counts", () => {
    // The vectors carry the label Python computed, so this covers the one
    // function the bucket-index cases never reach.
    const wrong = vectors.cases.filter(
      (c) => bucketLabel(c.value, c.levels, TONE_BUCKET_ORDER) !== c.label,
    );
    expect(wrong).toEqual([]);
    expect(new Set(vectors.cases.map((c) => c.label)).size).toBe(
      TONE_BUCKET_ORDER.length,
    );
  });

  it("refuses a level count the producer would refuse", () => {
    // `extentFor(1)` is 0, which makes `normalizeValue` return Infinity or
    // NaN and `bucketIndex` answer confidently rather than raising.
    for (const levels of [1, 0, -5, 2.5, 25, Number.NaN]) {
      expect(() => extentFor(levels)).toThrow();
      expect(() => bucketIndex(0.5, levels)).toThrow();
    }
    expect(() => extentFor(2)).not.toThrow();
    expect(() => extentFor(24)).not.toThrow();
  });

  it("carries the vocabularies and contract version the fixture records", () => {
    expect([...TONE_BUCKET_ORDER]).toEqual(
      vectors.vocabularies.TONE_BUCKET_ORDER,
    );
    expect([...LEANING_BUCKET_ORDER]).toEqual(
      vectors.vocabularies.LEANING_BUCKET_ORDER,
    );
    expect([...RUSSIA_BUCKET_ORDER]).toEqual(
      vectors.vocabularies.RUSSIA_BUCKET_ORDER,
    );
    expect(vectors.contract_version).toBeGreaterThanOrEqual(1);
  });

  it("keeps the generated vocabularies identical to labels.ts's own order", () => {
    // ⚠️ The two orders have SEPARATE homes — `labels.ts` has drawn these
    // spectrums since before any of this existed — so "one definition" is only
    // true while this passes. A silent divergence would flip the sign of every
    // positioned article against the stored corpus.
    expect([...LEANING_BUCKET_ORDER]).toEqual(LEANING_ORDER);
    expect([...RUSSIA_BUCKET_ORDER]).toEqual(RUSSIA_ORDER);
  });

  it("has a renderable label for every tone bucket", () => {
    // The defect that made this fixture necessary: the ordinal buckets emitted
    // `strongly_favorable`/`strongly_unfavorable`, which existed in no .ts file
    // at all, so the chip rendered blank while a label-COUNT guard passed.
    for (const label of TONE_BUCKET_ORDER) {
      expect(TONE_META[label]).toBeDefined();
      expect(TONE_META[label].label).toBeTruthy();
    }
  });
});
