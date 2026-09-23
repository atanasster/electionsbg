import { describe, expect, it } from "vitest";
import {
  browseKey,
  listState,
  normalizeQuery,
  queryStories,
  searchHydrated,
  withinDays,
  withinWindow,
  type FilterIndex,
  type FilterRow,
  QUERY_VERSION,
} from "./storyQuery";

const NOW = Date.parse("2026-09-21T12:00:00+00:00");
const at = (hours: number) =>
  new Date(NOW - hours * 3_600_000).toISOString().replace(/\.\d+Z$/, "+00:00");

const row = (
  id: string,
  hours: number,
  categories: string[],
  domains: string[],
): FilterRow => [id, at(hours), categories, domains];

const index = (stories: FilterRow[]): FilterIndex => ({
  query_version: QUERY_VERSION,
  fields: ["id", "last_published", "categories", "domains"],
  total: stories.length,
  facets_basis: { categories: "every topic", domains: "every outlet" },
  facets: { categories: {}, domains: {} },
  stories,
});

describe("queryStories", () => {
  const corpus = index([
    row("a", 1, ["energy"], ["x.bg"]),
    row("b", 2, ["energy", "economy"], ["x.bg", "y.bg"]),
    row("c", 100, ["economy"], ["y.bg"]),
    row("d", 3, ["judiciary"], ["z.bg"]),
  ]);

  it("sees the whole corpus, not a downloaded prefix", () => {
    // ⚠️ The defect this replaces: a chip read „2" while the corpus held 200.
    expect(queryStories(corpus, { now: NOW }).ids).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(queryStories(corpus, { now: NOW }).corpusTotal).toBe(4);
  });

  it("applies the window, the category and the outlet together", () => {
    expect(
      queryStories(corpus, { days: 1, category: "energy", now: NOW }).ids,
    ).toEqual(["a", "b"]);
    expect(
      queryStories(corpus, { domain: "y.bg", days: 1, now: NOW }).ids,
    ).toEqual(["b"]);
  });

  it("counts a facet with its OWN dimension relaxed", () => {
    // „Енергетика · 2" must mean what selecting it would show, keeping the
    // other filters. Counting with every filter applied makes every
    // unselected chip read 0 — an empty corpus rather than an unselected
    // option.
    const result = queryStories(corpus, {
      days: 1,
      category: "energy",
      now: NOW,
    });
    expect(result.facets.categories).toEqual({
      energy: 2,
      economy: 1,
      judiciary: 1,
    });
    // The domain facet keeps the selected category applied.
    expect(result.facets.domains).toEqual({ "x.bg": 2, "y.bg": 1 });
  });

  it("counts a story once per facet value, not once per reference", () => {
    // ⚠️ CARRIED OVER FROM `homeCategoryCounts`, WHICH THIS REPLACED. A story
    // carrying two topic refs in one category is one story; counting the refs
    // inflates every chip on the page by the corpus's tagging habits.
    const dupes = index([row("a", 1, ["energy", "energy"], ["x.bg", "x.bg"])]);
    expect(queryStories(dupes, { now: NOW }).facets).toEqual({
      categories: { energy: 1 },
      domains: { "x.bg": 1 },
    });
  });

  it("a facet count agrees with what selecting it returns", () => {
    // ⚠️ THE PROPERTY THE OLD CODE BROKE: the number on a chip and the length
    // of the list beneath it came from different sets.
    const base = queryStories(corpus, { days: 1, now: NOW });
    for (const [category, count] of Object.entries(base.facets.categories)) {
      expect(
        queryStories(corpus, { days: 1, category, now: NOW }).ids.length,
      ).toBe(count);
    }
    for (const [domain, count] of Object.entries(base.facets.domains)) {
      expect(
        queryStories(corpus, { days: 1, domain, now: NOW }).ids.length,
      ).toBe(count);
    }
  });

  it("reports the CORPUS total, not the matching count", () => {
    // ⚠️ EVERY OTHER ASSERTION HERE PASSES ON AN IMPLEMENTATION THAT RETURNS
    // `ids.length`, because the fixture's own total equals its row count and
    // the only other `corpusTotal` assertion is on an unfiltered query. The
    // field means the corpus; a consumer reading it as „matching" would make
    // an outlet page claim the corpus size as its participation count.
    const narrowed = queryStories(corpus, {
      days: 1,
      category: "energy",
      now: NOW,
    });
    expect(narrowed.ids).toHaveLength(2);
    expect(narrowed.corpusTotal).toBe(4);
  });

  it("relaxes each facet's OWN dimension, whatever is selected", () => {
    // ⚠️ THE INVARIANT `HomeScreen` RESTS ON, asserted as an invariant rather
    // than as one fixture's numbers. Its chip counts read
    // `corpus.result.facets.categories` off the query the page already runs,
    // which is only correct because the selected category is relaxed out of
    // that count by construction. A change making a facet respect its own
    // dimension would break the chips while the numeric test above could be
    // re-baselined without anyone asking why.
    const unfiltered = queryStories(corpus, { days: 1, now: NOW });
    for (const category of ["all", "energy", "economy", "judiciary"])
      expect(
        queryStories(corpus, { category, days: 1, now: NOW }).facets.categories,
      ).toEqual(unfiltered.facets.categories);
    for (const domain of ["all", "x.bg", "y.bg", "z.bg"])
      expect(
        queryStories(corpus, { domain, days: 1, now: NOW }).facets.domains,
      ).toEqual(unfiltered.facets.domains);
  });

  it("is empty and does not throw without an index", () => {
    expect(queryStories(null, { now: NOW }).ids).toEqual([]);
    expect(queryStories(undefined, { now: NOW }).corpusTotal).toBe(0);
  });
});

describe("withinDays", () => {
  it("refuses a future stamp", () => {
    // One outlet's bad clock would otherwise pin it to the top of every window.
    expect(withinDays(at(-5), 1, NOW)).toBe(false);
  });

  it("refuses a malformed stamp rather than coercing it", () => {
    expect(withinDays("2026-09-21", 1, NOW)).toBe(false);
    expect(withinDays("", 1, NOW)).toBe(false);
  });

  it("treats a zero window as no window", () => {
    expect(withinDays(at(10_000), 0, NOW)).toBe(true);
  });

  it("lets the caller say what a zero window means", () => {
    // ⚠️ THE TWO READINGS ARE OPPOSITE AND BOTH ARE RIGHT. These were two
    // copies under a comment claiming they were shared; the briefing reads a
    // zero as „no choice made", the corpus query as „no restriction".
    expect(withinWindow(at(10_000), 0, NOW, "all")).toBe(true);
    expect(withinWindow(at(10_000), 0, NOW, "none")).toBe(false);
    // And a null stamp is refused whichever reading applies.
    expect(withinWindow(null, 7, NOW, "all")).toBe(false);
    expect(withinWindow(undefined, 7, NOW, "none")).toBe(false);
  });
});

describe("searchHydrated", () => {
  const rows = [{ t: "Петрохан и разследването" }, { t: "Нещо друго" }];

  it("reports the scope it could actually see", () => {
    // ⚠️ „Няма резултати" over a tenth of the corpus reads as „no such story
    // exists". The scope is what makes the same emptiness honest.
    const { rows: hits, scope } = searchHydrated(
      rows,
      "петрохан",
      (r) => r.t,
      2_314,
    );
    expect(hits).toHaveLength(1);
    expect(scope).toEqual({ searched: 2, of: 2_314, complete: false });
  });

  it("is complete when every matching story was hydrated", () => {
    const { scope } = searchHydrated(rows, "", (r) => r.t, 2);
    expect(scope.complete).toBe(true);
  });

  it("returns every row when the query is blank", () => {
    expect(searchHydrated(rows, "   ", (r) => r.t, 2).rows).toHaveLength(2);
  });

  it("folds case and whitespace the way the corpus is written", () => {
    expect(normalizeQuery("  ПЕТРОХАН  и  ")).toBe("петрохан и");
  });
});

describe("browseKey", () => {
  const parts = {
    runId: "RUN-1",
    overlaySeq: 0,
    asOf: "2026-09-21T12:00:00+00:00",
    queryVersion: 1,
    query: { category: "all", domain: "all", days: 1, now: NOW },
    sort: "prominence",
  };

  it("changes when a hot overlay lands under the same run", () => {
    // ⚠️ An overlay changes the data without changing `run_id`, so paging
    // across a publish would mix two generations — one story twice, or never.
    expect(browseKey({ ...parts, overlaySeq: 1 })).not.toBe(browseKey(parts));
  });

  it("changes when the window's anchor moves", () => {
    // Two browses of „24 часа" a minute apart are different result sets;
    // sharing a key appends the second's page 2 to the first's page 1.
    expect(
      browseKey({ ...parts, query: { ...parts.query, now: NOW + 60_000 } }),
    ).not.toBe(browseKey(parts));
  });

  it("changes with the sort, the filters and the query contract", () => {
    for (const mutated of [
      { ...parts, sort: "latest" },
      { ...parts, query: { ...parts.query, category: "energy" } },
      { ...parts, query: { ...parts.query, domain: "x.bg" } },
      { ...parts, query: { ...parts.query, days: 7 } },
      { ...parts, queryVersion: 2 },
      { ...parts, asOf: "2026-09-21T13:00:00+00:00" },
    ])
      expect(browseKey(mutated)).not.toBe(browseKey(parts));
  });

  it("is stable for the same browse", () => {
    expect(browseKey(parts)).toBe(browseKey({ ...parts }));
  });
});

describe("listState", () => {
  const base = { revealed: 5, total: 40, hasMore: true, ready: true };

  it("tells apart the three things an empty list used to mean", () => {
    // ⚠️ „no such story exists" / „we have not looked" / „we could not look".
    expect(listState({ ...base, revealed: 0, total: 0 })).toBe("empty");
    expect(listState({ ...base, revealed: 0, total: 0, ready: false })).toBe(
      "loading",
    );
    expect(
      listState({
        ...base,
        revealed: 0,
        total: 0,
        ready: false,
        error: new Error("offline"),
      }),
    ).toBe("failed");
  });

  it("is partial only while the corpus holds more than the prefix", () => {
    expect(listState(base)).toBe("partial");
    expect(listState({ ...base, revealed: 40 })).toBe("complete");
    // Every page revealed IS the corpus, whatever the totals say.
    expect(listState({ ...base, hasMore: false })).toBe("complete");
  });

  it("does not read a failed count as an empty corpus", () => {
    // The whole reason `ready` is not `!loading`: `total` is 0 either way.
    expect(
      listState({
        revealed: 3,
        total: 0,
        hasMore: true,
        ready: false,
        error: new Error("500"),
      }),
    ).toBe("failed");
  });

  it("keeps answering from a stale index rather than refusing", () => {
    // A last-good index beside a failed refresh still knows the total.
    expect(listState({ ...base, error: new Error("refresh") })).toBe("partial");
  });
});
