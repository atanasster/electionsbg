// The strip's window rule is the one piece of logic on this hero that can be wrong without
// looking wrong, so it is pure and tested here rather than only exercised through a render.
//
// Two behaviours carry the plan's argument (§4.1) and are easy to regress:
//   • a CURRENT recess must show as trailing empty columns — that is the whole reason the
//     strip beat a lead card and a news rail for the hero slot;
//   • a HISTORICAL parliament must not, or a dissolved NS would draw thousands of empty
//     days and the strip would stop being a calendar.

import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { buildStripWindow } from "./stripWindow";

const sittings = (...dates: string[]) =>
  dates.map((date, i) => ({ date, items: 10 + i }));

describe("buildStripWindow", () => {
  test("returns nothing when the parliament has no sittings", () => {
    // NS 40–43 have no roll-call data at all; the caller renders the named-gap state.
    assert.deepEqual(buildStripWindow([], "2026-08-03"), []);
  });

  test("draws one column per calendar day, sittings and gaps alike", () => {
    const days = buildStripWindow(
      sittings("2026-07-01", "2026-07-03"),
      "2026-07-03",
    );
    assert.deepEqual(
      days.map((d) => d.date),
      ["2026-07-01", "2026-07-02", "2026-07-03"],
    );
    assert.deepEqual(
      days.map((d) => d.items),
      [10, 0, 11],
    );
  });

  test("a current recess shows as trailing empty columns", () => {
    // 12 days after the last sitting: the window runs to today, so the recess is drawn.
    const days = buildStripWindow(sittings("2026-07-20"), "2026-08-01");
    assert.equal(days[days.length - 1].date, "2026-08-01");
    assert.equal(days[days.length - 1].items, 0);
    assert.equal(
      days.filter((d) => d.items > 0).length,
      1,
      "only the sitting itself carries items",
    );
  });

  test("the last sitting stays in frame at every gap width", () => {
    // Regression: the width cap is measured from `end`, which during a recess is TODAY, so
    // at a gap of exactly MAX_WINDOW_DAYS the clamp pushed `start` one day PAST the last
    // sitting. The strip then drew 60 bare hairlines with no bar and no "last sitting"
    // line, while days.length stayed 60 so the no-data guard never fired — i.e. it read as
    // "the chamber did not sit" on a parliament that plainly had.
    for (const gap of [58, 59, 60, 61, 62]) {
      const last = new Date(Date.UTC(2026, 5, 1) + gap * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const days = buildStripWindow(sittings("2026-06-01"), last);
      assert.ok(
        days.some((d) => d.items > 0),
        `gap of ${gap} days lost the only sitting from the window`,
      );
    }
  });

  test("a long-dissolved parliament ends at its final sitting, not at today", () => {
    // Without this the 45th NS (last sat 2021-05-07) would draw ~1,900 empty columns.
    const days = buildStripWindow(sittings("2021-05-07"), "2026-08-03");
    assert.equal(days[days.length - 1].date, "2021-05-07");
    assert.equal(days.length, 1);
  });

  test("the window is capped so a sparse term stays legible", () => {
    // Twelve sittings spread over two years would otherwise ask for a 700-column strip.
    const spread = Array.from({ length: 12 }, (_, i) => ({
      date: `202${4 + Math.floor(i / 6)}-0${(i % 6) + 1}-01`,
      items: 5,
    }));
    const days = buildStripWindow(spread, "2025-06-02");
    assert.ok(
      days.length <= 60,
      `window was ${days.length} columns; the cap is 60`,
    );
    assert.equal(days[days.length - 1].date, "2025-06-02");
  });

  test("a date appearing twice in the index sums rather than overwrites", () => {
    // A split sitting must read as one busy day, not as only its last chunk.
    const days = buildStripWindow(
      [
        { date: "2026-07-01", items: 40 },
        { date: "2026-07-01", items: 15 },
      ],
      "2026-07-01",
    );
    assert.deepEqual(days, [{ date: "2026-07-01", items: 55 }]);
  });
});
