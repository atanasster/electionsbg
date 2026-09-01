// The two Phase 7 measurements: their judgement, on synthetic input.
//
// ⚠️ THESE ARE THE FUNCTIONS A GO/NO-GO DECISION RESTS ON, so a wrong one does not produce a
// wrong page — it produces a wrong DECISION, which is harder to notice and lasts longer. Both
// are pinned here against inputs the real corpus does not contain, because the two states that
// decide the verdict (an id that churns, an id that mutates) are exactly the ones the corpus is
// mostly free of.

import { describe, expect, it } from "vitest";
import type { HomeEventV1 } from "../../../src/data/home/homeTypes";
import { diffDays } from "./id_stability";
import { EXTRACTED, subjectsOf } from "./subjects";

const ev = (over: Partial<HomeEventV1> & { id: string }): HomeEventV1 => ({
  schemaVersion: 1,
  kind: "test",
  category: "local",
  occurredAt: "2026-08-20T00:00:00.000Z",
  firstSeenAt: "2026-08-20T00:00:00.000Z",
  dateBasis: "occurred",
  scope: { level: "national" },
  source: { id: "t", labelKey: "home_source_council" },
  coverage: { complete: true },
  route: "/",
  factKey: "home_fact_x",
  factArgs: {},
  backfill: false,
  verification: "automatic",
  materiality: 0.5,
  actionability: 0.5,
  ...over,
});

const DAY = "2026-08-21";

describe("diffDays — the two ways an id breaks a watch cursor", () => {
  it("counts a genuinely new fact as appeared, not as churn", () => {
    const d = diffDays(
      [ev({ id: "a" })],
      [ev({ id: "a" }), ev({ id: "b", route: "/b" })],
      DAY,
    );
    expect(d.appeared).toBe(1);
    expect(d.churned).toBe(0);
    expect(d.mutated).toBe(0);
  });

  it("CHURN: the same fact under a new id — every subscriber re-notified", () => {
    // The failure an id built from a derived value produces. A promotion's id carried its
    // walk-back start day until Phase 5, and that day moved with the corpus while the offer did
    // not — one offer, two ids on consecutive days.
    const before = [
      ev({
        id: "prices:promotion:limoni:2026-08-21",
        route: "/product/limoni",
      }),
    ];
    const after = [
      ev({
        id: "prices:promotion:limoni:2026-08-31",
        route: "/product/limoni",
      }),
    ];
    const d = diffDays(before, after, DAY);
    expect(d.churned).toBe(1);
    expect(d.appeared).toBe(0);
    expect(d.churnExamples[0]).toContain("→");
  });

  it("MUTATION: the same id carrying a different fact — silently marked as read", () => {
    // ⚠️ THE ONE THAT DECIDED THE VERDICT. Measured nine times on 2026-08-18, when a scraper
    // fix replaced the subject of nine Разград resolutions under their existing ids. A cursor
    // storing only `lastSeenEventId` filters the correction out as already seen.
    const before = [
      ev({ id: "council:resolution:r364", factArgs: { title: "Продажба" } }),
    ];
    const after = [
      ev({
        id: "council:resolution:r364",
        factArgs: { title: "Детска градина" },
      }),
    ];
    const d = diffDays(before, after, DAY);
    expect(d.mutated).toBe(1);
    expect(d.churned).toBe(0);
    expect(d.appeared).toBe(0);
  });

  it("does not count a row ageing out of the window as vanished", () => {
    // The window moves with the corpus, so a 40-day-old row leaving is the design working.
    const old = ev({ id: "old", occurredAt: "2026-06-01T00:00:00.000Z" });
    expect(diffDays([old], [], DAY).vanished).toBe(0);
  });

  it("…but does count one that left while still inside it", () => {
    const recent = ev({ id: "recent", occurredAt: "2026-08-20T00:00:00.000Z" });
    expect(diffDays([recent], [], DAY).vanished).toBe(1);
  });
});

describe("subjectsOf — attribution comes from declared fields, never from prose", () => {
  it("reads a place from the event's own scope, resolved and namespaced", () => {
    // `RAZ26` is one of the eight council keys that IS its own frontend code — see the
    // resolution clauses below for the three that are other municipalities'.
    expect(
      subjectsOf(
        ev({ id: "x", scope: { level: "municipality", id: "RAZ26" } }),
      ),
    ).toEqual([{ kind: "place", id: "obshtina:RAZ26" }]);
  });

  it("reads a product from its route", () => {
    expect(subjectsOf(ev({ id: "x", route: "/product/limoni" }))).toEqual([
      { kind: "product", id: "limoni" },
    ]);
  });

  it("reads a programme from the argument the register supplied", () => {
    expect(
      subjectsOf(ev({ id: "x", factArgs: { programme: "ПРСР 2023-2027" } })),
    ).toEqual([{ kind: "programme", id: "ПРСР 2023-2027" }]);
  });

  it("gives a national event NO subject", () => {
    // ⚠️ A FINDING, not a gap to paper over. „A parliamentary sitting happened" is not about a
    // place or a company; attaching it to one so every watchlist has something to show would
    // make the subscription meaningless.
    expect(subjectsOf(ev({ id: "x", scope: { level: "national" } }))).toEqual(
      [],
    );
  });

  it("never infers a subject from the fact's title", () => {
    // The clause that keeps this honest. A title naming a município must NOT produce a place
    // subscription — that fires on a coincidence of words and the reader cannot tell which.
    expect(
      subjectsOf(
        ev({
          id: "x",
          factArgs: { title: "Решение на Общински съвет Разград" },
        }),
      ),
    ).toEqual([]);
  });
});

describe("diffDays — the blind spots the first cut had", () => {
  it("catches a re-key that moved the DATE with the id", () => {
    // ⚠️ THE SHAPE THE DESIGN CLAIMS TO HAVE CLOSED, and the dated identity cannot see it. A
    // promotion id carried its walk-back start day, so when the day moved the id moved WITH it
    // — and a churn test keyed on `[factKey, route, factArgs, day]` scores that as a brand-new
    // event. `churnedLoose` is the date-free arm; a gap between the two is the finding.
    const before = [
      ev({
        id: "prices:promotion:limoni:2026-08-21",
        route: "/product/limoni",
        occurredAt: "2026-08-21T00:00:00.000Z",
      }),
    ];
    const after = [
      ev({
        id: "prices:promotion:limoni:2026-08-31",
        route: "/product/limoni",
        occurredAt: "2026-08-31T00:00:00.000Z",
      }),
    ];
    const d = diffDays(before, after, "2026-08-31");
    expect(d.churned).toBe(0); // the dated test cannot see it…
    expect(d.churnedLoose).toBe(1); // …and this is why both are reported
  });

  it("counts a scope move under a stable id as a mutation", () => {
    // ⚠️ THE CLASS THAT MATTERS MOST TO A SUBJECT-KEYED CURSOR, and `factOf` omitted `scope`
    // entirely. A row that changes município under an id the reader has already seen re-points
    // at a different SUBSCRIBER SET, silently.
    const before = [
      ev({ id: "c:1", scope: { level: "municipality", id: "RAZ26" } }),
    ];
    const after = [
      ev({ id: "c:1", scope: { level: "municipality", id: "PER32" } }),
    ];
    expect(diffDays(before, after, DAY).mutated).toBe(1);
  });

  it("counts a coverage flip under a stable id as a mutation", () => {
    // `coverage.complete` decides whether the reader is told „only the councils we read".
    const before = [ev({ id: "c:1", coverage: { complete: true } })];
    const after = [
      ev({
        id: "c:1",
        coverage: { complete: false, noteKey: "home_coverage_council_partial" },
      }),
    ];
    expect(diffDays(before, after, DAY).mutated).toBe(1);
  });

  it("splits every counter by the publication window", () => {
    // ⚠️ A MUTATION ON AN UNPUBLISHABLE ROW CANNOT HAVE BEEN DELIVERED. The first cut applied
    // the window to `vanished` alone and reported the adapter-output totals beside it, which
    // overstated the finding ~3× and illustrated it with a row eleven months out of window.
    const old = { occurredAt: "2025-09-30T00:00:00.000Z" };
    const before = [ev({ id: "c:1", ...old, factArgs: { title: "A" } })];
    const after = [ev({ id: "c:1", ...old, factArgs: { title: "B" } })];
    const d = diffDays(before, after, DAY);
    expect(d.mutated).toBe(1);
    expect(d.mutatedInWindow).toBe(0);
  });

  it("counts an aged-out row apart from one that vanished while publishable", () => {
    const aged = ev({ id: "old", occurredAt: "2025-01-01T00:00:00.000Z" });
    const fresh = ev({ id: "new", occurredAt: "2026-08-20T00:00:00.000Z" });
    const d = diffDays([aged, fresh], [], DAY);
    expect(d.agedOut).toBe(1);
    expect(d.vanished).toBe(1);
  });
});

describe("subjectsOf — the council key is not a municipality code", () => {
  it("resolves the shard key to the frontend obshtina code", () => {
    // ⚠️ THE CRITICAL ONE. `PDV01` is the council pipeline's key for Пловдив, and as a frontend
    // code it names **Асеновград**. Eleven of the twelve place attributions in the first
    // measured window were `PDV01`, so Plovdiv's decisions would have been delivered to
    // subscribers in Asenovgrad — plausibly, and undetectably.
    expect(
      subjectsOf(
        ev({ id: "x", scope: { level: "municipality", id: "PDV01" } }),
      ),
    ).toEqual([{ kind: "place", id: "obshtina:PDV22" }]);
    expect(
      subjectsOf(
        ev({ id: "x", scope: { level: "municipality", id: "BGS01" } }),
      ),
    ).toEqual([{ kind: "place", id: "obshtina:BGS04" }]);
  });

  it("REFUSES a key it cannot resolve rather than naming a place", () => {
    // An unresolvable subject is a finding. Falling back to the raw key is the mis-naming above.
    expect(
      subjectsOf(
        ev({ id: "x", scope: { level: "municipality", id: "ZZZ99" } }),
      ),
    ).toEqual([]);
  });

  it("namespaces obshtina and oblast so one cannot match the other", () => {
    expect(
      subjectsOf(ev({ id: "x", scope: { level: "oblast", id: "PDV" } })),
    ).toEqual([{ kind: "place", id: "oblast:PDV" }]);
  });

  it("extracts a company and an institution from their routes", () => {
    // ⚠️ BOTH ARE MEASURED ZEROS IN THE CORPUS, which is the finding — so the rules have to be
    // exercised here or „company 0" would be indistinguishable from „the rule never worked".
    expect(subjectsOf(ev({ id: "x", route: "/company/831915629" }))).toEqual([
      { kind: "company", id: "831915629" },
    ]);
    expect(subjectsOf(ev({ id: "x", route: "/awarder/000695089" }))).toEqual([
      { kind: "institution", id: "000695089" },
    ]);
  });

  it("decodes a percent-encoded route segment", () => {
    // Two spellings of one id would otherwise be two subscriptions.
    expect(
      subjectsOf(ev({ id: "x", route: "/product/kafe%20lavaca" })),
    ).toEqual([{ kind: "product", id: "kafe lavaca" }]);
  });

  it("declares which kinds have a rule at all", () => {
    // ⚠️ „NO RULE" AND „NO SUPPLY" ARE DIFFERENT ZEROS. `sector` has no extraction rule, so its
    // count of zero is not a measurement — and reporting it as one would misfire precisely when
    // Precondition 2 is re-checked against a corpus that has since grown one.
    expect(EXTRACTED.has("sector")).toBe(false);
    for (const k of [
      "place",
      "product",
      "company",
      "institution",
      "programme",
    ] as const)
      expect(EXTRACTED.has(k), k).toBe(true);
  });
});
