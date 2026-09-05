// The forward-looking anchors: are they plausible, and are they retired on time?
//
// ⚠ THE TWO FAILURES THIS FILE EXISTS FOR ARE BOTH SILENT. A mistyped month puts a
// confident date on the My-Area tile with nothing to contradict it; and an entry left in
// place after its election has been held and ingested advertises a past vote as upcoming —
// `nextElection` filters on `daysUntil >= 0`, so it does not error, it simply keeps
// returning the stale entry until the day passes.
//
// ⚠ NO ASSERTION HERE DEPENDS ON TODAY'S DATE. Every clock is injected. A gate that goes
// red because the calendar advanced lands on whoever is working that day, in a file they
// did not touch — and the one exception is deliberate and labelled.

import { describe, expect, it } from "vitest";
import catalogue from "@/data/json/presidential_elections.json";
import localCatalogue from "@/data/json/local_elections.json";
import {
  UPCOMING_ELECTIONS,
  daysUntil,
  formatLongDate,
  hasUpcomingLocalBallot,
  nextElection,
  type UpcomingElection,
} from "./upcomingElections";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const days = (from: string, to: string): number =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
const at = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

/** ⚠ `[0]` IS THE NEWEST — a gated invariant of the catalogue
 *  (`presidentialCatalogue.test.ts`), so this file trusts it in one way rather than
 *  sorting in one place and indexing in another. */
const NEWEST = catalogue[0].round1Date;
const ROUND1 = catalogue.map((c) => c.round1Date).sort();

/** The cadence window the ingested cycles establish. */
const cadence = (round1: string[]) => {
  const monthDays = round1.map((d) => d.slice(5));
  const gaps = round1
    .slice(1)
    .map((d, i) => days(round1[i], d))
    .sort((a, b) => a - b);
  return {
    earliest: monthDays.reduce((a, b) => (a < b ? a : b)),
    latest: monthDays.reduce((a, b) => (a > b ? a : b)),
    gapMin: gaps[0],
    gapMax: gaps[gaps.length - 1],
  };
};

/**
 * Every way `list` breaks the cadence `round1` establishes, as sentences.
 *
 * ⚠ THE EXEMPTION LIVES HERE, IN ONE PLACE A TEST CAN REACH. Written inline in a loop over
 * the real list it was unreachable: deleting `confidence !== "estimated"` left every test
 * green, because the committed list holds no scheduled presidential entry for the widened
 * predicate to catch. So the rule was asserted in three comments and enforced nowhere.
 */
const cadenceViolations = (
  list: UpcomingElection[],
  round1: string[],
): string[] => {
  const { earliest, latest, gapMin, gapMax } = cadence(round1);
  const last = round1[round1.length - 1];
  const out: string[] = [];
  for (const e of list) {
    // A decree outranks a pattern, so only an ESTIMATE is held to the corpus.
    if (e.kind !== "presidential" || e.confidence !== "estimated") continue;
    const md = e.date.slice(5);
    if (md < earliest || md > latest)
      out.push(`${e.date}: ${md} is outside ${earliest}..${latest}`);
    const gap = days(last, e.date);
    if (gap < gapMin || gap > gapMax)
      out.push(
        `${e.date}: ${gap}d after ${last}, outside ${gapMin}..${gapMax}`,
      );
  }
  return out;
};

describe("UPCOMING_ELECTIONS", () => {
  it("is ISO-dated and sorted ascending", () => {
    // The file's own instruction, and `nextElection` sorts defensively — but
    // `MyAreaUpcomingBallotTile` does not: it filters, takes `.slice(0, 3)` and renders in
    // array order, so an unsorted list picks an arbitrary three and lists them out of
    // sequence. (`hasUpcomingLocalBallot` is a `.some()` and cannot be harmed by order.)
    for (const e of UPCOMING_ELECTIONS) expect(e.date, e.kind).toMatch(ISO);
    const dates = UPCOMING_ELECTIONS.map((e) => e.date);
    expect(dates).toEqual([...dates].sort());
  });

  it("always has a future event to name", () => {
    // ⚠ THE ONE DELIBERATE CLOCK DEPENDENCE, and it is the point rather than an accident:
    // it fails only when EVERY anchor has passed, which is the state where the tile has
    // nothing to show and nobody has noticed. The last entry today is 2029.
    expect(nextElection()).not.toBeNull();
    expect(daysUntil(nextElection()!.date)).toBeGreaterThanOrEqual(0);
  });

  it("holds a presidential ESTIMATE to the cadence the corpus establishes", () => {
    // ⚠ MEASURED, NOT ASSUMED. The five ingested cycles put round 1 between 22 October and
    // 14 November, 1,806–1,841 days after the previous one. A window DERIVED from the data
    // catches a typo'd month or year; a hand-written „about five years" would not.
    expect(cadenceViolations(UPCOMING_ELECTIONS, ROUND1)).toEqual([]);

    // ⚠ NON-VACUITY, on ANY confidence. The clauses above are skipped for a `scheduled`
    // entry, so without this the suite passes on a list that no longer names a presidential
    // vote at all — and keying it on „estimated" would instead go red on the promotion
    // `upcomingElections.ts` itself instructs, with a bare length mismatch for a message.
    expect(
      UPCOMING_ELECTIONS.filter((e) => e.kind === "presidential"),
    ).toHaveLength(1);
  });

  it("keeps that window narrow enough to mean anything", () => {
    // ⚠ AN EXTRAORDINARY CYCLE WOULD DISARM THE GATE SILENTLY. Art. 97 (4) requires an
    // election within two months of a vacancy; ingesting one takes the month-day span from
    // 23 days to ~240 and the gap floor from 1,806 to ~497. The gate would keep PASSING and
    // stop discriminating — the „goes half-blind with nothing red" shape. Fail instead, so
    // somebody decides what the cadence means once the corpus holds an early election.
    const { earliest, latest, gapMin, gapMax } = cadence(ROUND1);
    expect(
      days(`2000-${earliest}`, `2000-${latest}`),
      "the month-day window has widened — has an extraordinary cycle been ingested?",
    ).toBeLessThan(40);
    expect(gapMax - gapMin).toBeLessThan(120);
  });

  it("would catch both a wrong month and a wrong year", () => {
    // ⚠ TWO CONTROLS, because the clauses fail differently: a wrong month keeps a plausible
    // gap and a wrong year keeps a plausible month-day, so each needs its own.
    const bad = (date: string): UpcomingElection[] => [
      { date, kind: "presidential", confidence: "estimated" },
    ];
    expect(cadenceViolations(bad("2026-09-08"), ROUND1).length).toBeGreaterThan(
      0,
    );
    expect(cadenceViolations(bad("2027-11-08"), ROUND1).length).toBeGreaterThan(
      0,
    );
    // …and the real anchor passes the same function, so the two above are not simply
    // rejecting everything.
    expect(cadenceViolations(bad("2026-11-08"), ROUND1)).toEqual([]);
  });

  it("exempts a SCHEDULED entry from the cadence, and would catch it estimated", () => {
    // A decree outranks a pattern: the Народно събрание may set a day the corpus's own
    // range does not contain. `2026-12-20` is outside it by construction.
    const decreed: UpcomingElection[] = [
      { date: "2026-12-20", kind: "presidential", confidence: "scheduled" },
    ];
    expect(cadenceViolations(decreed, ROUND1)).toEqual([]);
    // ⚠ THE CONTROL. The SAME date as an estimate must fail — otherwise the clause above
    // passes because the check is broken, not because the exemption fired. Deleting the
    // exemption now turns this red, which it did not before.
    expect(
      cadenceViolations([{ ...decreed[0], confidence: "estimated" }], ROUND1)
        .length,
    ).toBeGreaterThan(0);
  });

  it("names no election either corpus has already ingested", () => {
    // ⚠ THE RETIREMENT GATE. Once an ingest catalogues a cycle, its anchor must go —
    // otherwise My-Area advertises a vote that has been held, counted and published, for as
    // long as the stored date remains in the future. Nothing else notices: the tile renders,
    // the countdown counts, and every figure on the page is correct.
    const ingested = new Map<UpcomingElection["kind"], Set<string>>([
      ["presidential", new Set(catalogue.map((c) => c.round1Date))],
      ["local", new Set(localCatalogue.map((c) => c.round1Date))],
    ]);
    for (const e of UPCOMING_ELECTIONS) {
      const held = ingested.get(e.kind);
      // `european` has no catalogue in this repo — an omission with a reason.
      if (!held) continue;
      expect(
        held.has(e.date),
        `${e.date} is already ingested — it has happened; drop the anchor`,
      ).toBe(false);
    }
    const presidential = UPCOMING_ELECTIONS.filter(
      (e) => e.kind === "presidential",
    );
    for (const e of presidential)
      expect(
        e.date > NEWEST,
        `${e.date} is not after the newest ingested cycle (${NEWEST})`,
      ).toBe(true);
    // The control: both corpora really are non-empty, so the loop is not passing on two
    // empty sets.
    expect(ingested.get("presidential")!.size).toBeGreaterThan(0);
    expect(ingested.get("local")!.size).toBeGreaterThan(0);
  });
});

describe("formatLongDate", () => {
  it("renders the calendar day in UTC, not the viewer's zone", () => {
    // ⚠ THE CONTROL FIRST: prove the zones really disagree on this date, so the assertion
    // below cannot pass on a machine where every zone happens to agree. Without the UTC pin
    // the tile shows 7 November to every reader in the Americas while linking to the 8th.
    const la = new Intl.DateTimeFormat("en-GB", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "America/Los_Angeles",
    }).format(new Date("2026-11-08T00:00:00Z"));
    expect(la).toBe("7 November 2026");
    expect(formatLongDate("2026-11-08", "en")).toBe("8 November 2026");
    expect(formatLongDate("2026-11-08", "bg")).toContain("ноември");
  });
});

describe("hasUpcomingLocalBallot", () => {
  // ⚠ IT GATES A WHOLE SIDE COLUMN on `MyAreaScreen`, and its 365-day edge is live: the
  // 2027 anchor flips it around 2026-10-24. Pinned with an injected clock, so the boundary
  // is asserted without asserting today.
  const list: UpcomingElection[] = [
    { date: "2027-10-24", kind: "local", confidence: "estimated" },
  ];

  it("is false outside the window and true from the boundary in", () => {
    expect(hasUpcomingLocalBallot(list, at("2026-10-23"))).toBe(false);
    expect(hasUpcomingLocalBallot(list, at("2026-10-24"))).toBe(true);
    expect(hasUpcomingLocalBallot(list, at("2027-10-24"))).toBe(true);
    expect(hasUpcomingLocalBallot(list, at("2027-10-25"))).toBe(false);
  });

  it("ignores a non-local ballot inside the window", () => {
    expect(
      hasUpcomingLocalBallot(
        [{ date: "2027-10-24", kind: "presidential", confidence: "estimated" }],
        at("2027-01-01"),
      ),
    ).toBe(false);
  });
});
