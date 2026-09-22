import { describe, expect, it } from "vitest";

// ⚠️ Imported, not read off disk: these tests run in the jsdom project, so
// `node:fs` is unavailable and a `readFileSync` here fails the whole file
// at collection — which reads as "the vectors are missing" rather than
// "this test cannot do that".
import rawVectors from "../../news/eval_contract/overlay_vectors.json";

import {
  applyOverlayToPath,
  mergeStoryIndexRows,
  OverlayRemovedPath,
  OVERLAY_SCHEMA_VERSION,
  parseOverlay,
  storyIndexRow,
  type NewsOverlay,
} from "./overlayMerge";

/**
 * ⚠️ THE VECTORS ARE THE POINT, NOT THE UNIT TESTS BELOW THEM.
 *
 * The overlay merge exists twice — here and in
 * `news/scripts/overlay_merge.py` — because a browser cannot import
 * Python. The Python side is the specification: it is verified against a
 * full rebuild of a real corpus, so it cannot be wrong without that test
 * going red. This side has no such anchor of its own, and a twin tested
 * only against hand-written fixtures agrees with itself and with nothing
 * else.
 *
 * `news/eval_contract/overlay_vectors.json` is the anchor. The Python test
 * GENERATES it from real builds either side of a real merge and fails when
 * the committed copy is stale; this replays every case through the
 * TypeScript functions. So a rule can only change in both places at once,
 * and a client that quietly stopped narrowing feed records, or sorted ties
 * the other way, fails here rather than in production.
 */

interface VectorCase {
  name: string;
  overlay: NewsOverlay;
  paths: Array<{ path: string; base: unknown; expected: unknown }>;
  /** Paths this release retires — a throw, which no payload can express. */
  removed: string[];
  /** `story_index_row`'s output per touched story, from the Python side. */
  index_rows: Record<string, Record<string, unknown>>;
}

const vectors = rawVectors as unknown as {
  schema_version: number;
  cases: VectorCase[];
};

describe("the shared overlay vectors", () => {
  it("is the version this client implements", () => {
    expect(vectors.schema_version).toBe(OVERLAY_SCHEMA_VERSION);
  });

  it("carries cases that actually merge something", () => {
    // A vectors file of no-ops passes on both sides for ever.
    expect(vectors.cases.length).toBeGreaterThan(0);
    for (const testCase of vectors.cases) {
      expect(
        testCase.paths.some(
          (row) => JSON.stringify(row.base) !== JSON.stringify(row.expected),
        ),
        `${testCase.name} merges every path to its own base`,
      ).toBe(true);
    }
  });

  for (const testCase of vectors.cases) {
    describe(testCase.name, () => {
      it("parses as an overlay this client accepts", () => {
        expect(() => parseOverlay(testCase.overlay)).not.toThrow();
      });

      for (const row of testCase.paths) {
        it(`reproduces ${row.path}`, () => {
          const overlay = parseOverlay(testCase.overlay);
          expect(applyOverlayToPath(row.path, row.base, overlay)).toEqual(
            row.expected,
          );
        });
      }

      for (const path of testCase.removed) {
        it(`refuses ${path}, which this release retired`, () => {
          const overlay = parseOverlay(testCase.overlay);
          expect(() => applyOverlayToPath(path, {}, overlay)).toThrow(
            OverlayRemovedPath,
          );
        });
      }

      for (const [id, expected] of Object.entries(testCase.index_rows)) {
        it(`projects the index row for ${id}`, () => {
          const story = testCase.overlay.story_details[id].story as Record<
            string,
            unknown
          >;
          expect(storyIndexRow(story)).toEqual(expected);
        });
      }
    });
  }
});

const overlay = (patch: Partial<NewsOverlay> = {}): NewsOverlay =>
  parseOverlay({
    schema_version: OVERLAY_SCHEMA_VERSION,
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

describe("parseOverlay", () => {
  it("refuses a version it does not implement", () => {
    // ⚠️ Fail closed. A half-applied overlay skips the arms it does not
    // know, every path still parses, and the reader is shown a release
    // nobody built — with nothing to see it by.
    expect(() => parseOverlay({ ...overlay(), schema_version: 2 })).toThrow(
      /unsupported/,
    );
  });

  it("refuses a malformed arm rather than dropping it", () => {
    for (const bad of [
      { articles: { "a.bg": [1] } },
      { removed_story_ids: [7] },
      { story_details: { s1: "not an object" } },
      { latest_limit: 0 },
      { home: [] },
    ]) {
      expect(() => parseOverlay({ ...overlay(), ...bad } as unknown)).toThrow();
    }
  });
});

describe("applyOverlayToPath", () => {
  it("treats a bare path as the same file as a slashed one", () => {
    // ⚠️ `removed_paths`/`replaced_paths` were looked up slash-stripped
    // while every other arm compared the raw string, so `latest.json`
    // silently returned its unmerged base while `/latest.json` merged.
    const base = { articles: [] as unknown[] };
    const patched = overlay({
      articles: {
        "a.bg": [{ url: "https://a.bg/1", published: "2026-09-20T00:00:00Z" }],
      },
    });
    expect(applyOverlayToPath("latest.json", base, patched)).toEqual(
      applyOverlayToPath("/latest.json", base, patched),
    );
  });

  it("passes an untouched path straight through", () => {
    const base = { anything: true };
    expect(applyOverlayToPath("/stats.json", base, overlay())).toBe(base);
  });

  it("reports a retired path rather than serving a stale copy", () => {
    // The caller treats this as a miss — the file is genuinely gone from
    // this release, which is what the next cold tree will 404 on too.
    for (const [path, patch] of [
      ["/feedback-targets.json", { removed_paths: ["feedback-targets.json"] }],
      ["/stories/s1.json", { removed_story_ids: ["s1"] }],
      ["/articles/gone.bg.json", { removed_domains: ["gone.bg"] }],
    ] as Array<[string, Partial<NewsOverlay>]>) {
      expect(() => applyOverlayToPath(path, {}, overlay(patch))).toThrow(
        OverlayRemovedPath,
      );
    }
  });

  it("leaves an index page alone, because a page cannot be merged alone", () => {
    // ⚠️ The index is a newest-first pagination over the whole corpus, so
    // one story moving to the front shifts every page after it. A page
    // merged in isolation duplicates or drops stories at its own boundary
    // and recomputes its own `total`, so nothing looks wrong.
    const page = { page: 2, stories: [{ id: "a", last_published: "1" }] };
    const merged = applyOverlayToPath(
      "/stories/index-2.json",
      page,
      overlay({
        story_details: { b: { story: { id: "b", last_published: "9" } } },
      }),
    );
    expect(merged).toBe(page);
  });

  it("leaves an index page alone even when the overlay carries one", () => {
    // ⚠️ The overlay legitimately carries whole index pages when the page
    // COUNT moves. Handing one to a client that has already merged its own
    // accumulated prefix applies the same release twice — so the
    // pass-through must win over `replaced_paths`, not sit below it.
    const page = { page: 3, stories: [] as unknown[] };
    expect(
      applyOverlayToPath(
        "/stories/index-3.json",
        page,
        overlay({
          replaced_paths: { "stories/index-3.json": { page: 3, stories: [] } },
        }),
      ),
    ).toBe(page);
  });

  it("refuses to build a request from an id the producer could not write", () => {
    // A detail path is constructed from data; anything outside the
    // producer's own id charset is not a story this release can hold.
    const patched = overlay({
      story_details: { s1: { story: { id: "s1" } } },
    });
    const base = { story: { id: "other" } };
    expect(applyOverlayToPath("/stories/../secret.json", base, patched)).toBe(
      base,
    );
  });

  it("narrows feed records to the feed's own fields", () => {
    // ⚠️ The overlay carries BUNDLE records, which are wider. Publishing
    // them unnarrowed re-inflates by ~25% the one object every page
    // downloads before it can paint — and far more than that once
    // `analysis` is in it, which measured 70% of the file gzipped.
    const merged = applyOverlayToPath(
      "/latest.json",
      { generated_at: "old", articles: [] },
      overlay({
        articles: {
          "a.bg": [
            {
              url: "https://a.bg/1",
              published: "2026-09-20T00:00:00Z",
              keywords: ["x"],
              section_path: "/x",
              first_seen: "2026-09-20T00:00:00Z",
              image_alt: "alt",
              title: "Заглавие",
              analysis: { summary_en: "In English", summary_bg: "На български" },
            },
          ],
        },
      }),
    ) as { articles: Array<Record<string, unknown>> };
    expect(Object.keys(merged.articles[0]).sort()).toEqual([
      "has_analysis",
      "published",
      "summary_en",
      "title",
      "url",
    ]);
    // ⚠️ A PROJECTION, not a field filter. Dropping `analysis` without
    // deriving these two publishes records the cold build does not, for
    // exactly the articles a hot run touched — and `summary_en` is what
    // every article page's English meta description is built from.
    expect(merged.articles[0].has_analysis).toBe(true);
    expect(merged.articles[0].summary_en).toBe("In English");
    expect(merged.articles[0].analysis).toBeUndefined();
  });

  it("says an article has no analysis rather than omitting the answer", () => {
    // `has_analysis` is the feed's only remaining signal that an analysis
    // exists, so `false` has to be published: absent would read to a
    // consumer as "built before the trim", which is the fallback case.
    const merged = applyOverlayToPath(
      "/latest.json",
      { generated_at: "old", articles: [] },
      overlay({
        articles: {
          "a.bg": [
            {
              url: "https://a.bg/1",
              published: "2026-09-20T00:00:00Z",
              title: "Заглавие",
            },
          ],
        },
      }),
    ) as { articles: Array<Record<string, unknown>> };
    expect(merged.articles[0].has_analysis).toBe(false);
    expect(merged.articles[0].summary_en).toBeUndefined();
  });

  it("breaks ties by url so a hot release cannot reorder the feed", () => {
    // Without the tiebreak the merged order depends on arrival order,
    // which differs from the rebuild's — so the same second's articles
    // would swap places between the hourly release and the one after it.
    const merged = applyOverlayToPath(
      "/latest.json",
      {
        articles: [
          { url: "https://b.bg/1", published: "2026-09-20T00:00:00Z" },
        ],
      },
      overlay({
        articles: {
          "a.bg": [
            { url: "https://a.bg/1", published: "2026-09-20T00:00:00Z" },
          ],
        },
      }),
    ) as { articles: Array<{ url: string }> };
    expect(merged.articles.map((row) => row.url)).toEqual([
      "https://b.bg/1",
      "https://a.bg/1",
    ]);
  });
});

describe("mergeStoryIndexRows", () => {
  it("moves a touched story to its new place rather than duplicating it", () => {
    const rows = [
      { id: "b", last_published: "2" },
      { id: "a", last_published: "1" },
    ];
    const merged = mergeStoryIndexRows(
      rows,
      overlay({
        story_details: { a: { story: { id: "a", last_published: "9" } } },
      }),
    );
    expect(merged.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("drops a story the release retired", () => {
    const merged = mergeStoryIndexRows(
      [{ id: "a", last_published: "1" }],
      overlay({ removed_story_ids: ["a"] }),
    );
    expect(merged).toEqual([]);
  });
});
