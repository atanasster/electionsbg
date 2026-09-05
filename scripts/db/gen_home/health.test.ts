// `home:health`'s judgement — on SYNTHETIC coverage, because the failures it exists for are
// states the committed artifacts are (correctly) never in.
//
// ⚠️ THE FIRST CUT OF THIS FILE RAN EVERY CLAUSE AGAINST THE COMMITTED PAIR, so `missing`,
// `corrupt`, `schema`, `unavailable`, `unbuilt` and `stale` were all unexercised, and
// `checkPublic` — exported specifically so it could be tested — had none at all. Worse, its
// „passes on the committed artifacts" clause asserted `checkArtifacts()` is EMPTY, which turns
// the first genuine operational incident (a crawl down for six days) into a red build for every
// contributor, on a condition none of them caused and none can fix in code — against `feed.ts`'s
// own „⚠️ REPORTED, NEVER FATAL".

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type {
  HomeFeedV1,
  HomeHubStatsV1,
} from "../../../src/data/home/homeTypes";
import {
  ARTIFACT_STALE_AFTER_DAYS,
  PUBLIC_ARTIFACTS,
  checkArtifacts,
  loadArtifacts,
  type HomeArtifacts,
} from "./health";
import { REFRESH_GENERATORS } from "../refresh_coverage";

const REPO = path.resolve(__dirname, "../../..");
const NOW = Date.parse("2026-09-02T12:00:00.000Z");

const feedOf = (
  coverage: HomeFeedV1["sourceCoverage"],
  computedAt = "2026-09-01T23:59:59.999Z",
): HomeFeedV1 =>
  ({
    schemaVersion: 1,
    computedAt,
    windowDays: 30,
    events: [],
    sourceCoverage: coverage,
  }) as HomeFeedV1;

const statsOf = (computedAt = "2026-09-01"): HomeHubStatsV1 =>
  ({ schemaVersion: 1, computedAt, sources: {} }) as unknown as HomeHubStatsV1;

const artifacts = (over: Partial<HomeArtifacts> = {}): HomeArtifacts => ({
  stats: statsOf(),
  feed: feedOf({
    prices: {
      available: true,
      asOf: "2026-09-01",
      observedAt: "2026-09-01",
      staleAfterDays: 5,
      stale: false,
    },
  }),
  problems: [],
  ...over,
});

const kinds = (p: ReturnType<typeof checkArtifacts>) => p.map((x) => x.kind);

describe("the public artifacts are the ones something builds and publishes", () => {
  it("every object the browser reads is a registered generator's artifact", () => {
    // ⚠️ A PAGE-READ BLOB WITH NO GENERATOR ENTRY IS PUBLISHED BY NOBODY. `REFRESH_GENERATORS`
    // is what puts an artifact in the chain AND names the sync path that uploads it.
    const known = new Set(
      Object.values(REFRESH_GENERATORS).map((g) => g.artifact),
    );
    for (const a of PUBLIC_ARTIFACTS)
      expect(
        known.has(a.file),
        `${a.file} has no REFRESH_GENERATORS entry`,
      ).toBe(true);
  });

  it("names the three the home page fetches, and not the intermediate", () => {
    // `price_events.json` is committed and published for inspectability, but no browser reads
    // it — so a 404 on it is not a page failure and must not be reported as one.
    // `flyover.json` IS read, just later than the other two: the band fetches it only once it
    // arms, which is what keeps first paint at two requests. „Committed but never uploaded"
    // does not care when the fetch happens, so it belongs here all the same.
    expect(PUBLIC_ARTIFACTS.map((a) => a.object)).toEqual([
      "home/hub_stats.json",
      "home/feed.json",
      "home/flyover.json",
    ]);
  });
});

describe("checkArtifacts — the states that all answer 200", () => {
  it("says nothing about a healthy pair", () => {
    expect(checkArtifacts(artifacts(), NOW)).toEqual([]);
  });

  it("separates an absent artifact from an unparseable one", () => {
    // ⚠️ DIFFERENT FIXES: run the generator, or `git checkout`. Reported identically, the ops
    // doc's „the generator has never run here" sends the operator to the wrong one.
    expect(
      kinds(
        checkArtifacts(
          artifacts({ problems: [{ kind: "missing", detail: "x" }] }),
          NOW,
        ),
      ),
    ).toContain("missing");
    expect(
      kinds(
        checkArtifacts(
          artifacts({ problems: [{ kind: "corrupt", detail: "x" }] }),
          NOW,
        ),
      ),
    ).toContain("corrupt");
  });

  it("flags a schema it does not know how to read", () => {
    const bad = { ...statsOf(), schemaVersion: 2 } as unknown as HomeHubStatsV1;
    expect(kinds(checkArtifacts(artifacts({ stats: bad }), NOW))).toContain(
      "schema",
    );
  });

  it("flags a stalled pipeline — the case a within-artifact measure cannot see", () => {
    // ⚠️ THE CLAUSE THE ABSOLUTE ARM EXISTS FOR. `stale` is frozen into the artifact and
    // measured against that artifact's own `computedAt`, so when everything stops, every lag
    // is unchanged and a relative-only check prints „healthy" for ever — the same blindness
    // this tool is justified by attributing to `db:check-generated`.
    const old = ARTIFACT_STALE_AFTER_DAYS + 3;
    const day = new Date(NOW - old * 86_400_000).toISOString().slice(0, 10);
    const stalled = artifacts({
      feed: feedOf({
        prices: {
          available: true,
          asOf: day,
          observedAt: day,
          staleAfterDays: 5,
        },
      }),
    });
    expect(kinds(checkArtifacts(stalled, NOW))).toContain("unbuilt");
  });

  it("does NOT flag an artifact whose SOURCES are simply old", () => {
    // ⚠️ THE FALSE POSITIVE THE FIRST CUT SHIPPED. Both artifacts date themselves by their
    // newest source vintage, so `hub_stats` weeks back is its ordinary state — quarterly macro
    // and the sibling hub blobs. Measuring the absolute arm on `computedAt` flagged a perfectly
    // healthy pair on every single run.
    const healthy = artifacts({ stats: statsOf("2026-07-31") });
    expect(kinds(checkArtifacts(healthy, NOW))).not.toContain("unbuilt");
  });

  it("notices when no family reports an observation clock at all", () => {
    // Then `computedAt` has silently fallen back to an event date, and the window is anchored
    // on something that can be in the future.
    const noClock = artifacts({
      feed: feedOf({ prices: { available: true, asOf: "2026-09-01" } }),
    });
    expect(kinds(checkArtifacts(noClock, NOW))).toContain("unbuilt");
  });

  it("separates an unreadable source from a quiet one", () => {
    // „We could not look" and „nothing happened" are different failures, and only the first is
    // operational — so they carry different kinds, which is the only field the union
    // discriminates on. They shared `stale` while the comment above them insisted otherwise.
    const down = artifacts({
      feed: feedOf({
        prices: { available: false },
        council: {
          available: true,
          asOf: "2026-09-01",
          observedAt: "2026-09-01",
        },
      }),
    });
    expect(kinds(checkArtifacts(down, NOW))).toContain("unavailable");
    expect(kinds(checkArtifacts(down, NOW))).not.toContain("stale");
  });

  it("flags a family past its cadence, and not one inside it", () => {
    const late = artifacts({
      feed: feedOf({
        prices: {
          available: true,
          asOf: "2026-08-20",
          observedAt: "2026-09-01",
          staleAfterDays: 5,
        },
      }),
    });
    expect(kinds(checkArtifacts(late, NOW))).toContain("stale");
  });

  it("computes the verdict LIVE, so a tightened ceiling takes effect immediately", () => {
    // ⚠️ THE STORED FLAG IS NOT THE AUTHORITY. It was decided against whatever the constant
    // held when the artifact was generated, so tightening a ceiling used to change the PRINTED
    // number and not the verdict — and the run still exited 0. `prices` is 5 in the code; an
    // artifact built against 400 and carrying `stale: false` must still be caught.
    const stale = artifacts({
      feed: feedOf({
        prices: {
          available: true,
          asOf: "2026-08-01",
          observedAt: "2026-09-01",
          staleAfterDays: 400,
          stale: false,
        },
      }),
    });
    const details = checkArtifacts(stale, NOW)
      .filter((p) => p.kind === "stale")
      .map((p) => p.detail)
      .join(" | ");
    expect(details).toContain("ceiling 5d");
    expect(details).toContain("400d ceiling");
  });

  it("counts a declared cadence with no vintage as unchecked, not as fine", () => {
    // The loop used to `continue` here, so the family was never checked while its ceiling was
    // printed beside it. `{ available: true, newest: null }` is a real adapter return shape.
    const noVintage = artifacts({
      feed: feedOf({
        prices: {
          available: true,
          observedAt: "2026-09-01",
          staleAfterDays: 5,
        },
      }),
    });
    expect(kinds(checkArtifacts(noVintage, NOW))).toContain("unavailable");
  });

  it("says nothing about a family that declares no cadence", () => {
    // Bulgaria's last two elections are 539 days apart; a ceiling loose enough for that
    // detects nothing, so the honest answer is that the family has none.
    const elections = artifacts({
      feed: feedOf({
        prices: {
          available: true,
          asOf: "2026-09-01",
          observedAt: "2026-09-01",
        },
        elections: { available: true, asOf: "2026-04-19" },
      }),
    });
    expect(checkArtifacts(elections, NOW)).toEqual([]);
  });

  it("flags an unreadable hub-stats source", () => {
    const blind = artifacts({
      stats: {
        ...statsOf(),
        sources: { gdp: { available: false } },
      } as unknown as HomeHubStatsV1,
    });
    expect(kinds(checkArtifacts(blind, NOW))).toContain("unavailable");
  });
});

describe("the committed pair", () => {
  it("parses and declares the current schema", () => {
    // ⚠️ ONLY THE KINDS A CONTRIBUTOR CAN BE RESPONSIBLE FOR. Asserting the whole result is
    // empty makes a deliberately non-fatal operational warning — a crawl down for six days —
    // into a red build for everyone. Freshness belongs to `home:health`, not to `test:unit`.
    const structural = checkArtifacts(loadArtifacts(), NOW).filter(
      (p) =>
        p.kind === "missing" || p.kind === "corrupt" || p.kind === "schema",
    );
    expect(structural).toEqual([]);
  });

  it("is the pair the health check names", () => {
    for (const a of PUBLIC_ARTIFACTS)
      expect(() =>
        JSON.parse(readFileSync(path.join(REPO, a.file), "utf-8")),
      ).not.toThrow();
  });
});
