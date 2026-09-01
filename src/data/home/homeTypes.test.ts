// The two rules `homeTypes.ts` encodes as CODE rather than as prose, plus the fixtures that
// make them testable. Both exist because the plan's own audit found the repo already carries
// a counter-example to each.

import { describe, expect, it } from "vitest";
import {
  HOME_DATE_BASES,
  HOME_EVENT_CATEGORIES,
  HOME_FIGURE_IDS,
  HOME_MODES,
  NOW_RELATIVE_FIELD_NAMES,
  findNowRelativeFields,
  homeFigureIdIsHonest,
} from "./homeTypes";
import {
  HOME_EVENT_BACKFILL_FIXTURE,
  HOME_EVENT_FIRST_SEEN_FIXTURE,
  HOME_EVENT_OCCURRED_FIXTURE,
  HOME_EVENT_UNKNOWN_KIND_FIXTURE,
  HOME_FEED_FIXTURE,
  HOME_FIGURES_FIXTURE,
  HOME_STATS_FIXTURE,
  HOME_STATS_PARTIAL_FIXTURE,
} from "./__fixtures__/home";

describe("homeFigureIdIsHonest", () => {
  it("rejects an id that claims to be a CPI", () => {
    // `cpi` is TAKEN in this corpus: macro.indicators.cpi is Transparency International's
    // Corruption Perceptions Index and macro.series.cpi is its 0–100 score. An inflation
    // figure called `inflation_cpi` reads as a corruption score AND names the wrong index —
    // the figure is HICP (prc_hicp_minr).
    expect(homeFigureIdIsHonest("inflation_cpi")).toBe(false);
    expect(homeFigureIdIsHonest("cpi")).toBe(false);
    expect(homeFigureIdIsHonest("cpi_yoy")).toBe(false);
    expect(homeFigureIdIsHonest("national_CPI")).toBe(false);
  });

  it("does not reject an id that merely contains those letters", () => {
    // A substring test would fail these, and the rule is about the WORD.
    expect(homeFigureIdIsHonest("recipient_count")).toBe(true);
    expect(homeFigureIdIsHonest("cpil")).toBe(true);
    expect(homeFigureIdIsHonest("acpi")).toBe(true);
  });

  it("every declared figure id passes", () => {
    for (const id of HOME_FIGURE_IDS)
      expect(homeFigureIdIsHonest(id)).toBe(true);
    expect(HOME_FIGURE_IDS).toContain("inflation_hicp");
    expect(HOME_FIGURE_IDS).not.toContain("inflation_cpi");
  });
});

describe("findNowRelativeFields", () => {
  it("finds a banned key at the top level", () => {
    expect(findNowRelativeFields({ deadlineAt: "x", daysLeft: 3 })).toEqual([
      "daysLeft",
    ]);
  });

  it("finds one nested inside factArgs, which is where it would actually appear", () => {
    // The realistic shape: the event's own fields are typed, so a stray now-relative value
    // arrives through the untyped `factArgs` bag.
    const event = {
      ...HOME_EVENT_FIRST_SEEN_FIXTURE,
      factArgs: { programme: "ИК", daysLeft: 12 },
    };
    expect(findNowRelativeFields(event)).toEqual(["daysLeft"]);
  });

  it("walks arrays", () => {
    expect(
      findNowRelativeFields({ events: [{ ok: 1 }, { closingSoon: true }] }),
    ).toEqual(["closingSoon"]);
  });

  it("reports each key once and sorts, so a failure message is stable", () => {
    const found = findNowRelativeFields({
      a: { isOpen: true },
      b: { isOpen: false, daysLeft: 1 },
    });
    expect(found).toEqual(["daysLeft", "isOpen"]);
  });

  it("passes a clean artifact", () => {
    // The gate's whole value is that a real artifact returns []. If the fixtures tripped it,
    // every later assertion would be measuring the fixture rather than the rule.
    expect(findNowRelativeFields(HOME_FEED_FIXTURE)).toEqual([]);
    expect(findNowRelativeFields(HOME_STATS_FIXTURE)).toEqual([]);
  });

  it("terminates on a cycle instead of recursing for ever", () => {
    // Parsed JSON cannot carry a cycle, but this is exported so the GENERATOR can refuse —
    // and a generator refuses on a half-built in-memory object, where a back-reference is
    // possible. Without the seen-set this test hangs rather than fails.
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(findNowRelativeFields(a)).toEqual([]);
    const b: Record<string, unknown> = { daysLeft: 1 };
    b.back = b;
    expect(findNowRelativeFields(b)).toEqual(["daysLeft"]);
  });

  it("tolerates null and primitives without throwing", () => {
    expect(findNowRelativeFields(null)).toEqual([]);
    expect(findNowRelativeFields(undefined)).toEqual([]);
    expect(findNowRelativeFields("daysLeft")).toEqual([]);
    expect(findNowRelativeFields(7)).toEqual([]);
  });

  it("names the ones that matter", () => {
    // `deadlineAt` is STORED and must never be banned; `daysLeft` is the rendered form.
    expect(NOW_RELATIVE_FIELD_NAMES).toContain("daysLeft");
    expect(NOW_RELATIVE_FIELD_NAMES).toContain("isOpen");
    expect(NOW_RELATIVE_FIELD_NAMES).not.toContain("deadlineAt");
    expect(NOW_RELATIVE_FIELD_NAMES).not.toContain("computedAt");
  });
});

describe("fixtures", () => {
  it("the two date-basis fixtures differ ONLY in how they are dated", () => {
    // If they differed in other ways a renderer test could pass by keying on something else,
    // and the date-basis distinction would be untested.
    expect(HOME_EVENT_OCCURRED_FIXTURE.occurredAt).toBeTruthy();
    expect(HOME_EVENT_OCCURRED_FIXTURE.dateBasis).toBe("occurred");
    expect(HOME_EVENT_FIRST_SEEN_FIXTURE.occurredAt).toBeUndefined();
    expect(HOME_EVENT_FIRST_SEEN_FIXTURE.publishedAt).toBeUndefined();
    expect(HOME_EVENT_FIRST_SEEN_FIXTURE.effectiveAt).toBeUndefined();
    expect(HOME_EVENT_FIRST_SEEN_FIXTURE.dateBasis).toBe("first_seen");
    expect(HOME_EVENT_FIRST_SEEN_FIXTURE.firstSeenAt).toBeTruthy();
  });

  it("the partial fixture OMITS the unavailable figure rather than zeroing it", () => {
    const ids = HOME_STATS_PARTIAL_FIXTURE.figures.map((f) => f.id);
    expect(ids).not.toContain("inflation_hicp");
    expect(ids).toHaveLength(3);
    // `sources` is `Partial`, so this reads through an optional — which is the point of
    // FINDING-008's type change: a consumer cannot pretend a dangling sourceId is present.
    expect(
      HOME_STATS_PARTIAL_FIXTURE.sources.eurostat_prc_hicp_minr?.available,
    ).toBe(false);
    // The claim being guarded: no figure anywhere carries a zero standing in for absence.
    expect(HOME_STATS_PARTIAL_FIXTURE.figures.some((f) => f.value === 0)).toBe(
      false,
    );
  });

  it("the backfill fixture is one row carrying a count, not many rows", () => {
    expect(HOME_EVENT_BACKFILL_FIXTURE.backfill).toBe(true);
    expect(HOME_EVENT_BACKFILL_FIXTURE.factArgs.rows).toBe(41233);
    // Low enough that the ranking's backfill penalty has something to act on.
    expect(HOME_EVENT_BACKFILL_FIXTURE.materiality).toBeLessThan(0.25);
  });

  it("the unknown-kind fixture is genuinely unknown", () => {
    // It has to be rejectable BY KIND. If it accidentally matched a real adapter, the gate it
    // exists to prove would be asserting nothing.
    const known = HOME_FEED_FIXTURE.events.map((e) => e.kind);
    expect(known).not.toContain(HOME_EVENT_UNKNOWN_KIND_FIXTURE.kind);
  });

  it("every fixture enum value is declared", () => {
    for (const e of [
      ...HOME_FEED_FIXTURE.events,
      HOME_EVENT_UNKNOWN_KIND_FIXTURE,
    ]) {
      expect(HOME_EVENT_CATEGORIES).toContain(e.category);
      expect(HOME_DATE_BASES).toContain(e.dateBasis);
    }
    expect(HOME_MODES).toContain(HOME_STATS_FIXTURE.homeMode);
    for (const f of HOME_FIGURES_FIXTURE) {
      expect(HOME_FIGURE_IDS).toContain(f.id);
      // Every figure names a source that the artifact actually declares — a dangling
      // sourceId renders a figure with no provenance.
      expect(Object.keys(HOME_STATS_FIXTURE.sources)).toContain(f.sourceId);
    }
  });

  it("the feed's window ends at computedAt, not after it", () => {
    // The anchoring rule, asserted on the fixture so a later generator test has a shape to
    // compare against: no event may be newer than the artifact's own vintage.
    const newest = HOME_FEED_FIXTURE.events
      .map((e) => e.occurredAt ?? e.publishedAt ?? e.firstSeenAt)
      .sort()
      .at(-1) as string;
    expect(newest <= HOME_FEED_FIXTURE.computedAt).toBe(true);
  });
});
