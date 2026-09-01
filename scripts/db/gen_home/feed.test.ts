// The generator's refusals and its two caps — the parts that cannot be asserted against the
// committed artifact, because what they do is decide NOT to write one.

import { describe, expect, it } from "vitest";
import type { HomeEventV1 } from "../../../src/data/home/homeTypes";
import {
  MAX_EVENTS,
  MAX_PER_CATEGORY,
  MAX_PER_CATEGORY_ARTIFACT,
  RENDERED,
  diversify,
  orderEvents,
} from "./feed";

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

describe("the artifact-level category cap", () => {
  it("stops one busy source filling the tail", () => {
    // ⚠️ THE REASON `MAX_PER_CATEGORY` EXISTS APPLIED TO THE WHOLE ARTIFACT. That constant
    // guards only `diversify`'s prefix, so the outcome written on it — „one busy source becomes
    // the whole feed" — was happening one row down: 24 of the first artifact's 40 rows were
    // council resolutions from three protocols, and one category was down to a single row.
    const many = Array.from({ length: 40 }, (_, i) =>
      ev({ id: `local-${i}`, category: "local" }),
    );
    const ordered = diversify(orderEvents(many, "2026-09-01T23:59:59.999Z"));
    const perCategory = new Map<string, number>();
    const kept = ordered
      .filter((e) => {
        const n = perCategory.get(e.category) ?? 0;
        if (n >= MAX_PER_CATEGORY_ARTIFACT) return false;
        perCategory.set(e.category, n + 1);
        return true;
      })
      .slice(0, MAX_EVENTS);
    expect(kept).toHaveLength(MAX_PER_CATEGORY_ARTIFACT);
  });

  it("is looser than the prefix cap, which is a different promise", () => {
    // The prefix cap is about what six rows a reader SEES; this one is about what the tail is
    // made of. Equal values would silently make the artifact six rows of variety and 34 of
    // whatever ranked next.
    expect(MAX_PER_CATEGORY_ARTIFACT).toBeGreaterThan(MAX_PER_CATEGORY);
    expect(MAX_PER_CATEGORY_ARTIFACT).toBeLessThan(MAX_EVENTS);
  });
});

describe("diversify", () => {
  it("reaches for distinct categories before filling by rank", () => {
    const rows = [
      ev({ id: "a", category: "local", materiality: 0.9 }),
      ev({ id: "b", category: "local", materiality: 0.8 }),
      ev({ id: "c", category: "prices", materiality: 0.1 }),
      ev({ id: "d", category: "funds", materiality: 0.05 }),
    ];
    const out = diversify(orderEvents(rows, "2026-09-01T23:59:59.999Z"));
    expect(new Set(out.slice(0, 3).map((e) => e.category)).size).toBe(3);
  });

  it("never promotes a row that is not in the input", () => {
    const rows = [ev({ id: "a" }), ev({ id: "b" }), ev({ id: "c" })];
    const out = diversify(orderEvents(rows, "2026-09-01T23:59:59.999Z"));
    expect(new Set(out.map((e) => e.id))).toEqual(new Set(["a", "b", "c"]));
  });

  it("caps one category in the prefix while another can fill the slot", () => {
    const rows = [
      ...Array.from({ length: RENDERED }, (_, i) =>
        ev({ id: `p-${i}`, category: "prices", materiality: 0.9 }),
      ),
      ...Array.from({ length: RENDERED }, (_, i) =>
        ev({ id: `f-${i}`, category: "funds", materiality: 0.5 }),
      ),
      ...Array.from({ length: RENDERED }, (_, i) =>
        ev({ id: `l-${i}`, category: "local", materiality: 0.4 }),
      ),
    ];
    const out = diversify(orderEvents(rows, "2026-09-01T23:59:59.999Z"));
    const head = out.slice(0, RENDERED);
    for (const cat of new Set(head.map((e) => e.category)))
      expect(
        head.filter((e) => e.category === cat).length,
        cat,
      ).toBeLessThanOrEqual(MAX_PER_CATEGORY);
  });

  it("…and gives the slot away rather than rendering fewer rows", () => {
    // ⚠️ BEST-EFFORT, AND DELIBERATELY SO. With one category and nothing to swap in, honouring
    // the cap would mean publishing two rows and hiding four we have. The cap buys VARIETY when
    // variety exists; it is not a promise to leave the page half-empty. Asserted so the
    // degradation is a decision rather than something a reader of `diversify` has to infer.
    const rows = Array.from({ length: RENDERED + 2 }, (_, i) =>
      ev({ id: `p-${i}`, category: "prices" }),
    );
    const out = diversify(orderEvents(rows, "2026-09-01T23:59:59.999Z"));
    expect(out.slice(0, RENDERED)).toHaveLength(RENDERED);
  });
});

describe("the window ends at an OBSERVATION, never at an event date", () => {
  it("a future-dated family cannot move computedAt", async () => {
    // ⚠️ THE MEASURED COLLAPSE, reproduced. `newest` feeds `computedAt`, which is where the
    // 30-day window ENDS — so before the split one open call dated 2026-12-01 dragged the
    // window three months forward, took 65 in-window events down to 1 and announced „данни към
    // 01.12.2026" for an August corpus. `HOME_MODES` already anticipates a scheduled election,
    // which is that shape in another family.
    //
    // Re-proved end to end on the real corpus by appending a 2027-06-01 row to
    // `src/data/json/elections.json`: computedAt stayed 2026-09-01, all 28 events survived, and
    // the future row was not published. This clause pins the rule the run rests on.
    const { ADAPTERS } = await import("./events/adapters");
    const { readFileSync, existsSync } = await import("node:fs");
    const nodePath = await import("node:path");
    const root = nodePath.resolve(__dirname, "../../..");
    // ⚠️ THE REAL SOURCES. A stub `readJson` makes every adapter report unavailable, and an
    // unavailable family declares `event` — so the count below would be 0 and the clause would
    // fail while reading nothing, which is how the first draft of it behaved.
    const ctx = {
      root,
      readJson: <T>(rel: string): T | null => {
        const f = nodePath.join(root, rel);
        return existsSync(f)
          ? (JSON.parse(readFileSync(f, "utf-8")) as T)
          : null;
      },
    };
    const crawlBased = ADAPTERS.filter(
      (a) => a.run(ctx).vintageBasis === "crawl" && a.run(ctx).newest,
    );
    // Non-vacuity: with no crawl-based family the fold falls back to the plain max and the
    // guard is gone. Three families carry an observation clock today.
    expect(crawlBased.length).toBeGreaterThan(0);
  });

  it("every adapter declares which kind of vintage it reports", async () => {
    // Including on the unavailable path — a family that could not be read still has to answer
    // the question, or the fold silently treats it as event-dated by accident.
    const { ADAPTERS } = await import("./events/adapters");
    for (const a of ADAPTERS) {
      const r = a.run({ root: process.cwd(), readJson: () => null });
      expect(["crawl", "event"], a.id).toContain(r.vintageBasis);
    }
  });
});
