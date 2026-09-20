import { describe, expect, it } from "vitest";

import { storyListView, type StoryIndexRow } from "./data";
import { parseOverlay, type NewsOverlay } from "./overlayMerge";

/**
 * Plan §4.6(b) — the story index under a hot release.
 *
 * ⚠️ THESE TWO RULES ARE THE ONLY PART OF THE OVERLAY THE DATA CLIENT
 * CANNOT DO. `applyOverlayToPath` refuses an index PAGE, because a page is
 * a slice of one whole-corpus ordering: merged alone it duplicates or
 * drops stories at its own boundary, and it recomputes its own `total`, so
 * nothing looks wrong. The prefix a reader has revealed has no such
 * problem — which is why the merge lives in the hook, and why it is pulled
 * out here as pure functions rather than tested through a rendered list.
 */

const row = (
  id: string,
  lastPublished: string | null,
  extra: Partial<StoryIndexRow> = {},
): StoryIndexRow =>
  ({
    id,
    title_bg: id,
    title_en: id,
    topics: [],
    first_published: lastPublished,
    last_published: lastPublished,
    member_count: 1,
    domains: ["a.bg"],
    ...extra,
  }) as StoryIndexRow;

const overlayWith = (patch: Partial<NewsOverlay> = {}): NewsOverlay =>
  parseOverlay({
    schema_version: 1,
    seq: 1,
    base_run_id: "run-1",
    generated_at: "2026-09-20T12:00:00Z",
    release_generated_at: "2026-09-20T12:00:00Z",
    latest_limit: 150,
    articles: {},
    removed_article_urls: {},
    removed_domains: [],
    bundle_envelopes: {},
    story_details: {},
    removed_story_ids: [],
    home: null,
    replaced_paths: {},
    removed_paths: [],
    ...patch,
  });

const story = (id: string, lastPublished: string | null) => ({
  story: {
    id,
    title_bg: id,
    title_en: id,
    topics: [],
    first_published: lastPublished,
    last_published: lastPublished,
    members: [{ domain: "a.bg", url: `https://a.bg/${id}` }],
  },
});

const view = (
  revealed: StoryIndexRow[],
  overlay: NewsOverlay | null,
  {
    baseTotal = 200,
    hasMore = true,
  }: { baseTotal?: number | null; hasMore?: boolean } = {},
) => storyListView({ revealed, overlay, baseTotal, hasMore });

const ids = (revealed: StoryIndexRow[], overlay: NewsOverlay | null) =>
  view(revealed, overlay).stories.map((item) => item.id);

describe("the revealed order", () => {
  it("orders by content, not by the order pages arrived", () => {
    // ⚠️ THE DEFECT THIS REPLACED. The rows live in a `Map`, which
    // iterates in insertion order — so a story that moved to the front
    // between releases kept the position it was first seen at, and the
    // list claimed to be newest-first while quietly not being.
    expect(
      ids(
        [
          row("a", "2026-09-01T00:00:00Z"),
          row("c", "2026-09-03T00:00:00Z"),
          row("b", "2026-09-02T00:00:00Z"),
        ],
        null,
      ),
    ).toEqual(["c", "b", "a"]);
  });

  it("breaks ties by id, the publisher's own rule", () => {
    expect(ids([row("b", null), row("a", null), row("c", null)], null)).toEqual(
      ["c", "b", "a"],
    );
  });

  it("does not mutate the array it is given", () => {
    const revealed = [
      row("a", "2026-09-01T00:00:00Z"),
      row("z", "2026-09-09T00:00:00Z"),
    ];
    view(revealed, null);
    expect(revealed.map((item) => item.id)).toEqual(["a", "z"]);
  });

  it("places a hot release's new story by its date, not at an end", () => {
    expect(
      ids(
        [row("c", "2026-09-03T00:00:00Z"), row("a", "2026-09-01T00:00:00Z")],
        overlayWith({
          story_details: { b: story("b", "2026-09-02T00:00:00Z") },
        }),
      ),
    ).toEqual(["c", "b", "a"]);
  });

  it("moves a touched story rather than showing it twice", () => {
    const merged = view(
      [row("c", "2026-09-03T00:00:00Z"), row("a", "2026-09-01T00:00:00Z")],
      overlayWith({ story_details: { a: story("a", "2026-09-09T00:00:00Z") } }),
    ).stories;
    expect(merged.map((item) => item.id)).toEqual(["a", "c"]);
    expect(merged.filter((item) => item.id === "a")).toHaveLength(1);
  });

  it("keeps a revealed story even when the release re-dates it downwards", () => {
    // It is below the prefix boundary now, but the reader has it on
    // screen — dropping it would make a row vanish mid-scroll.
    expect(
      ids(
        [row("c", "2026-09-03T00:00:00Z"), row("a", "2026-09-01T00:00:00Z")],
        overlayWith({
          story_details: { c: story("c", "2020-01-01T00:00:00Z") },
        }),
      ),
    ).toEqual(["a", "c"]);
  });

  it("does not inject a story that belongs below the revealed prefix", () => {
    // ⚠️ A story the overlay touched on page 5 does not belong in a
    // two-page prefix: it would render at the bottom, ahead of the
    // hundreds of stories that really sit between. It arrives with the
    // page that holds it.
    expect(
      ids(
        [row("c", "2026-09-03T00:00:00Z")],
        overlayWith({
          story_details: { buried: story("buried", "2020-01-01T00:00:00Z") },
        }),
      ),
    ).toEqual(["c"]);
  });

  it("injects it once every page is loaded", () => {
    // With nothing left to fetch there is no "below the prefix" — the
    // revealed rows are the corpus.
    expect(
      view(
        [row("c", "2026-09-03T00:00:00Z")],
        overlayWith({
          story_details: { buried: story("buried", "2020-01-01T00:00:00Z") },
        }),
        { hasMore: false },
      ).stories.map((item) => item.id),
    ).toEqual(["c", "buried"]);
  });

  it("drops a story the release retired", () => {
    expect(
      ids(
        [row("a", "2026-09-01T00:00:00Z"), row("b", "2026-09-02T00:00:00Z")],
        overlayWith({ removed_story_ids: ["a"] }),
      ),
    ).toEqual(["b"]);
  });

  it("projects the overlay's story through the index row shape", () => {
    // The list renders `member_count` and `domains`, which live on the
    // story rather than on its index row — a merge that forwarded the
    // story object would render a card with no outlet chips.
    const merged = view(
      [],
      overlayWith({ story_details: { b: story("b", "2026-09-02T00:00:00Z") } }),
    ).stories;
    expect(merged[0]).toMatchObject({
      id: "b",
      member_count: 1,
      domains: ["a.bg"],
    });
    expect(merged[0]).not.toHaveProperty("members");
  });
});

describe("the caption", () => {
  const revealed = [row("c", "2026-09-03T00:00:00Z")];
  const total = (
    overlay: NewsOverlay | null,
    options?: { baseTotal?: number | null; hasMore?: boolean },
  ) => view(revealed, overlay, options).total;

  it("is the base count when no release is in flight", () => {
    expect(total(null)).toBe(200);
  });

  it("counts a genuinely new story", () => {
    expect(
      total(
        overlayWith({
          story_details: { n: story("n", "2026-09-09T00:00:00Z") },
        }),
      ),
    ).toBe(201);
  });

  it("does not count a story it merely touched", () => {
    // ⚠️ `story_details` changes when a story gains a RECIPROCAL related
    // link and nothing else about it moves. Counting those as new inflates
    // the caption on every hot release.
    expect(
      total(
        overlayWith({
          story_details: { c: story("c", "2026-09-03T00:00:00Z") },
        }),
      ),
    ).toBe(200);
  });

  it("does not count a story it did not show", () => {
    expect(
      total(
        overlayWith({
          story_details: { old: story("old", "2026-01-01T00:00:00Z") },
        }),
      ),
    ).toBe(200);
  });

  it("separates the two at the boundary in one overlay", () => {
    // ⚠️ THE MUTATION CHECK. With the boundary taken from the MERGED list
    // — which already contains both — this reads 202, and the guard that
    // is supposed to exclude `buried` is a tautology.
    expect(
      total(
        overlayWith({
          story_details: {
            fresh: story("fresh", "2026-09-09T00:00:00Z"),
            buried: story("buried", "2026-01-01T00:00:00Z"),
          },
        }),
      ),
    ).toBe(201);
  });

  it("subtracts a retired story the reader can see", () => {
    expect(total(overlayWith({ removed_story_ids: ["c"] }))).toBe(199);
  });

  it("never contradicts the list it captions", () => {
    // ⚠️ A caption below the number of rows on screen is the one output
    // nobody can explain, and it is exactly what two separate functions
    // produced. Asserted across the shapes rather than reasoned about.
    const overlay = overlayWith({
      story_details: {
        fresh: story("fresh", "2026-09-09T00:00:00Z"),
        buried: story("buried", "2026-01-01T00:00:00Z"),
      },
    });
    for (const [baseTotal, hasMore] of [
      [200, true],
      [1, true],
      [200, false],
      [null, true],
    ] as Array<[number | null, boolean]>) {
      const got = view(revealed, overlay, { baseTotal, hasMore });
      expect(got.total).toBeGreaterThanOrEqual(got.stories.length);
    }
  });

  it("trusts the rows once every page is loaded", () => {
    // No inference left to make: the revealed rows ARE the corpus.
    expect(
      total(
        overlayWith({
          story_details: { n: story("n", "2026-09-09T00:00:00Z") },
        }),
        { hasMore: false },
      ),
    ).toBe(2);
  });

  it("falls back to the rows before any page has loaded", () => {
    expect(total(null, { baseTotal: null })).toBe(1);
  });
});
