// The strip's bar arithmetic. Extracted from the component precisely so this file can exist:
// the geometry was wrong for weeks of the corpus and no test could see it, because
// buildStripWindow is pure and the component's pixels are not covered anywhere.

import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { barGeometry } from "./stripBars";

const day = (
  items: number,
  tally?: { yes: number; no: number; abstain: number },
) => ({ date: "2026-07-31", items, ...(tally ? { tally } : {}) });

describe("barGeometry", () => {
  test("the segments fill the RENDERED bar even when the minimum-height clamp fires", () => {
    // THE DEFECT. The 52nd's peak is a 219-item budget day, so a 1-item sitting scales to a
    // raw 4 px and is clamped up to 8. The first draft scaled the segments against the raw 4
    // and let the abstain span absorb the rest as flex-1, so a day that was 93% „за" painted
    // half its column as „въздържали се".
    const { height, segments } = barGeometry(
      day(1, { yes: 200, no: 10, abstain: 5 }),
      219,
    );
    assert.equal(height, 8);
    assert.ok(segments);
    assert.equal(segments.yes + segments.no + segments.abstain, height);
    // 93% of the cast votes — the segment must dominate the column, not share it.
    assert.ok(
      segments.yes >= 7,
      `за was ${segments.yes}px of ${height}px for a 93% share`,
    );
    assert.ok(segments.abstain <= 1, `въздържали се was ${segments.abstain}px`);
  });

  test("the three segments always sum to exactly the bar, over the whole range", () => {
    for (const items of [1, 2, 5, 9, 21, 97, 149, 219]) {
      for (const t of [
        { yes: 1, no: 1, abstain: 1 },
        { yes: 100, no: 0, abstain: 0 },
        { yes: 7, no: 11, abstain: 13 },
        { yes: 585, no: 8, abstain: 19 },
      ]) {
        const { height, segments } = barGeometry(day(items, t), 219);
        assert.ok(segments);
        assert.equal(
          segments.yes + segments.no + segments.abstain,
          height,
          `items=${items} tally=${JSON.stringify(t)}`,
        );
        assert.ok(Math.min(segments.yes, segments.no, segments.abstain) >= 0);
      }
    }
  });

  test("a day with no split gets no segments, not three zeroes", () => {
    // index.json carries no tallies at all. Zeroed segments would draw a real sitting as an
    // empty stack — pixel-identical to a day the chamber voted for nothing.
    assert.equal(barGeometry(day(12), 219).segments, null);
  });

  test("a tallied day with zero cast votes also gets no segments", () => {
    // The 49th's final sitting: items present, roll call absent. There is no split to draw.
    assert.equal(
      barGeometry(day(2, { yes: 0, no: 0, abstain: 0 }), 219).segments,
      null,
    );
  });

  test("the square-root scale keeps a small sitting visible against the peak", () => {
    // Linear, a 14-of-237 day is 3px and reads as a gap; that is the one comparison the
    // strip exists to make.
    const small = barGeometry(day(14), 237).height;
    assert.ok(small >= 14, `a 14-item day drew ${small}px against a 237 peak`);
    assert.ok(small < barGeometry(day(237), 237).height);
  });

  test("shares are what the pixels are rounded from, and sum to 1", () => {
    // The strip must DISPLAY the share, never the raw tally: those are votes summed over
    // every item of the day, so the 52nd's 219-item budget sitting reads „за 15 961" in a
    // chamber of 240. Returning both from one function is what keeps the number the tooltip
    // prints and the pixels the bar draws from drifting apart — they did, one commit after
    // hub_feed.ts documented the trap.
    const { height, segments, shares, cast } = barGeometry(
      day(219, { yes: 15961, no: 9708, abstain: 17710 }),
      237,
    );
    assert.ok(shares && segments);
    assert.equal(cast, 15961 + 9708 + 17710);
    assert.ok(Math.abs(shares.yes + shares.no + shares.abstain - 1) < 1e-12);
    // Every share is a fraction — anything above 1 means a count leaked into the field the
    // tooltip formats as a percentage.
    for (const v of Object.values(shares))
      assert.ok(v >= 0 && v <= 1, `share ${v}`);
    // And the pixels follow them: yes is the smallest share here, so it is not the tallest
    // segment.
    assert.ok(segments.abstain >= segments.yes);
    assert.equal(segments.yes + segments.no + segments.abstain, height);
  });

  test("a day with no split has no shares either", () => {
    const g = barGeometry(day(12), 219);
    assert.equal(g.shares, null);
    assert.equal(g.cast, 0);
  });
});
