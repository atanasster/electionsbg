// The presidential cycle a selected parliamentary vote anchors to.

import { describe, expect, it } from "vitest";
import { presidentialAsOf } from "./presidentialAsOf";
import catalogue from "./json/presidential_elections.json";

describe("presidentialAsOf", () => {
  it("defaults to the newest cycle when nothing is selected", () => {
    expect(presidentialAsOf().cycle).toBe("2021_11_14_pvr");
    expect(presidentialAsOf().clampedToOldest).toBe(false);
  });

  it("re-anchors an older parliamentary selection", () => {
    // ⚠ THE WHOLE POINT. A reader on the 2013 parliamentary vote who clicks through to „the
    // presidential result" must not be handed 2021 — the page would say one date and the
    // destination be about another, at a 200.
    expect(presidentialAsOf("2013_05_12").cycle).toBe("2011_10_23_pvr");
    expect(presidentialAsOf("2017_03_26").cycle).toBe("2016_11_06_pvr");
    expect(presidentialAsOf("2026_04_19").cycle).toBe("2021_11_14_pvr");
  });

  it("anchors on round 1, so a vote held between the rounds is inside that election", () => {
    // ⚠ 2011's rounds are 23 and 30 October. A parliamentary vote on the 26th falls inside a
    // presidential election that has begun and not finished; anchoring on the RUNOFF would
    // name the previous cycle, which is true of the office and false of the election — and
    // the destination is an election.
    expect(presidentialAsOf("2011_10_26").cycle).toBe("2011_10_23_pvr");
    expect(presidentialAsOf("2011_10_22").cycle).toBe("2006_10_22_pvr");
    // Round-1 day itself counts as inside it.
    expect(presidentialAsOf("2011_10_23").cycle).toBe("2011_10_23_pvr");
  });

  it("re-anchors from a LOCAL selection too, by date", () => {
    // ⚠ THE CASE THE SCREEN MISSED. It passed `undefined` for any non-parliamentary cycle,
    // and `undefined` means „the newest" — so a reader on the 2019 local cycle would have
    // been handed 2021 while the scope pill read „Местен вот · 27 октомври 2019". The hub's
    // resolved cycle carries an ISO date for every kind, so one call covers all three.
    expect(presidentialAsOf("2019-10-27").cycle).toBe("2016_11_06_pvr");
    expect(presidentialAsOf("2023-10-29").cycle).toBe("2021_11_14_pvr");
    // A suffixed id lands on the same side of every comparison as its own date.
    expect(presidentialAsOf("2019_10_27_mi").cycle).toBe(
      presidentialAsOf("2019-10-27").cycle,
    );
    // The control: the newest selection still resolves to the newest cycle, so a rule that
    // simply returned the oldest would not pass.
    expect(presidentialAsOf("2026-04-19").cycle).toBe("2021_11_14_pvr");
  });

  it("clamps below the corpus and SAYS SO", () => {
    // The presidential corpus starts in 2001 and the parliamentary one in 2005, so nothing
    // reaches this today — which is why it is asserted rather than assumed.
    const r = presidentialAsOf("1997_04_19");
    expect(r.cycle).toBe("2001_11_11_pvr");
    expect(r.clampedToOldest).toBe(true);
    // The control: an in-range selection must NOT be reported as clamped, or the flag says
    // nothing.
    expect(presidentialAsOf("2013_05_12").clampedToOldest).toBe(false);
  });

  it("returns a cycle that is actually in the catalogue", () => {
    const ids = new Set(catalogue.map((c) => c.name));
    for (const d of ["1997_04_19", "2005_06_25", "2013_05_12", "2026_04_19"])
      expect(ids.has(presidentialAsOf(d).cycle), d).toBe(true);
  });
});
