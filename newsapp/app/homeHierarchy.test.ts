import { describe, expect, it } from "vitest";
import type { ArticleRecord, Story } from "./data";
import { buildHomeHierarchy, homeStoryKind } from "./homeHierarchy";

const story = (id: string, outlets: number, published: string): Story =>
  ({
    id,
    title_bg: id,
    title_en: null,
    summary_bg: "Резюме",
    summary_en: null,
    first_published: published,
    last_published: published,
    topics: [],
    related_story_ids: [],
    entities: {
      people: [],
      parties: [],
      institutions: [],
      companies: [],
      places: [],
    },
    aggregates: {
      article_count: outlets,
      outlet_count: outlets,
      by_leaning: {},
      by_russia_stance: {},
      by_party_tone: {},
      by_domain: {},
    },
    blindspot: null,
    members: [],
  }) as Story;

const article = (
  id: string,
  storyId: string,
  published: string,
  over: Partial<ArticleRecord> = {},
): ArticleRecord =>
  ({
    id,
    domain: "example.bg",
    story_id: storyId,
    published,
    image: "https://upload.wikimedia.org/example.jpg",
    analysis: { summary_bg: "Резюме" },
    image_rights: {
      status: "cc",
      creator: "Автор",
      credit_text: "Автор · CC BY 4.0",
      credit_url: "https://commons.wikimedia.org/wiki/File:Example.jpg",
      licence_name: "CC BY 4.0",
      licence_url: "https://creativecommons.org/licenses/by/4.0/",
      source_url: "https://commons.wikimedia.org/wiki/File:Example.jpg",
      checked_at: "2026-08-28",
      display_home: true,
    },
    ...over,
  }) as ArticleRecord;

describe("home hierarchy", () => {
  it("uses the newest eligible story as the lead and removes it from support", () => {
    const broad = story("broad", 4, "2026-08-27T09:00:00+00:00");
    const fresh = story("fresh", 2, "2026-08-28T09:00:00+00:00");
    const single = story("single", 1, "2026-08-29T09:00:00+00:00");
    const result = buildHomeHierarchy(
      [single, fresh, broad],
      [
        article("a", "broad", "2026-08-27T09:00:00+00:00"),
        article("b", "fresh", "2026-08-28T09:00:00+00:00"),
        article("c", "single", "2026-08-29T09:00:00+00:00"),
      ],
    );

    expect(result.lead?.story.id).toBe("single");
    expect(result.supporting.map((item) => item.story.id)).not.toContain(
      "single",
    );
  });

  it("cannot classify a one-outlet cluster as a comparison", () => {
    expect(homeStoryKind(story("single", 1, "2026-08-28T09:00:00Z"))).toBe(
      "analyzed_article",
    );
  });

  it("drops stories without an analyzed representative article", () => {
    const result = buildHomeHierarchy(
      [
        story("eligible", 2, "2026-08-28T09:00:00Z"),
        story("raw", 5, "2026-08-28T10:00:00Z"),
      ],
      [
        article("a", "eligible", "2026-08-28T09:00:00Z"),
        article("b", "raw", "2026-08-28T10:00:00Z", {
          analysis: undefined,
        }),
      ],
    );
    expect(
      [result.lead, ...result.supporting].map((item) => item?.story.id),
    ).toEqual(["eligible"]);
  });

  it.each([
    { image: null },
    { image_rights: undefined },
    { image: null, image_rights: { status: "blocked", display_home: false } },
    { image: null, image_rights: { status: "cc", display_home: false } },
  ] as Partial<ArticleRecord>[])(
    "keeps an analyzed text-first representative out of the lead: %o",
    (over) => {
      const result = buildHomeHierarchy(
        [story("held", 2, "2026-08-28T09:00:00Z")],
        [article("a", "held", "2026-08-28T09:00:00Z", over)],
      );
      expect(result.lead).toBeNull();
      expect(result.supporting).toHaveLength(1);
      expect(result.supporting[0]?.story.id).toBe("held");
      expect(result.supporting[0]?.imageArticle).toBeNull();
    },
  );

  it("prefers an older cleared image within a story over a newer text row", () => {
    const item = story("mixed", 2, "2026-08-28T10:00:00Z");
    const cleared = article("cleared", item.id, "2026-08-28T09:00:00Z");
    const result = buildHomeHierarchy(
      [item],
      [
        cleared,
        article("text", item.id, "2026-08-28T10:00:00Z", {
          image: null,
          image_rights: undefined,
        }),
      ],
    );
    expect(result.lead?.imageArticle.id).toBe(cleared.id);
  });

  it("keeps a summary-less story out of the hero but in support", () => {
    const noSummary = story("no-summary", 3, "2026-08-28T09:00:00Z");
    noSummary.summary_bg = " ";
    const result = buildHomeHierarchy(
      [noSummary],
      [article("a", noSummary.id, "2026-08-28T09:00:00Z")],
    );
    expect(result.lead).toBeNull();
    expect(result.supporting[0]?.story.id).toBe("no-summary");
  });

  it("orders supporting stories by actual recency, including offset timestamps", () => {
    // ⚠️ The two same-day stories carry the SAME outlet count on purpose. The
    // lead ranks on breadth within a freshness bucket, so an unequal count
    // here would decide the lead before recency was consulted and this test
    // would stop being about parsing `+03:00` at all.
    const lead = story("lead", 4, "2026-08-26T09:00:00Z");
    const earlier = story("earlier", 3, "2026-08-28T10:00:00+03:00");
    const later = story("later", 3, "2026-08-28T08:00:00Z");
    const result = buildHomeHierarchy(
      [earlier, lead, later],
      [
        article("a", lead.id, lead.last_published!),
        article("b", earlier.id, earlier.last_published!),
        article("c", later.id, later.last_published!),
      ],
    );
    expect(result.lead?.story.id).toBe("later");
    expect(result.supporting.map((item) => item.story.id)).toEqual([
      "earlier",
      "lead",
    ]);
  });

  it("leads on breadth among stories of comparable freshness", () => {
    // ⚠️ Freshness alone collapses to "the newest item with an image":
    // publication timestamps are near-unique, so a strict recency sort settles
    // every comparison before breadth is consulted. Within a 24h bucket the
    // wider story leads even when it is two hours older.
    const narrow = story("narrow", 1, "2026-08-28T12:00:00Z");
    const wide = story("wide", 5, "2026-08-28T10:00:00Z");
    const result = buildHomeHierarchy(
      [narrow, wide],
      [
        article("a", narrow.id, narrow.last_published!),
        article("b", wide.id, wide.last_published!),
      ],
    );
    expect(result.lead?.story.id).toBe("wide");
    // Support keeps its own recency order — only the LEAD ranks on breadth.
    expect(result.supporting.map((item) => item.story.id)).toEqual(["narrow"]);
  });

  it("treats two stories minutes apart as equally fresh across midnight UTC", () => {
    // ⚠️ THE case the bucket has to get right. Under an absolute `t / 24h`
    // grid these two — two minutes apart — land in different buckets and
    // breadth is never consulted, so the narrower story leads. Measured on the
    // committed corpus, 7 of 16 stories sit within 90 minutes of that
    // boundary. Anchored on the freshest candidate, they are comparable.
    const narrow = story("narrow", 1, "2026-08-29T00:01:00Z");
    const wide = story("wide", 5, "2026-08-28T23:59:00Z");
    const result = buildHomeHierarchy(
      [narrow, wide],
      [
        article("a", narrow.id, narrow.last_published!),
        article("b", wide.id, wide.last_published!),
      ],
    );
    expect(result.lead?.story.id).toBe("wide");
  });

  it("does not let breadth outrank a fresher day", () => {
    const stale = story("stale", 9, "2026-08-20T12:00:00Z");
    const fresh = story("fresh", 1, "2026-08-28T12:00:00Z");
    const result = buildHomeHierarchy(
      [stale, fresh],
      [
        article("a", stale.id, stale.last_published!),
        article("b", fresh.id, fresh.last_published!),
      ],
    );
    expect(result.lead?.story.id).toBe("fresh");
  });

  it("honors a zero supporting limit", () => {
    const only = story("only", 1, "2026-08-28T09:00:00Z");
    expect(
      buildHomeHierarchy(
        [only],
        [article("a", only.id, only.last_published!)],
        0,
      ).supporting,
    ).toEqual([]);
  });

  it("uses the vacant lead slot for a sixteenth text-first story", () => {
    const stories = Array.from({ length: 16 }, (_, index) => {
      const item = story(
        `text-${index}`,
        1,
        `2026-08-28T${String(23 - index).padStart(2, "0")}:00:00Z`,
      );
      return item;
    });
    const articles = stories.map((item, index) =>
      article(`a-${index}`, item.id, item.last_published!, {
        image: null,
        image_rights: undefined,
      }),
    );
    const result = buildHomeHierarchy(stories, articles);
    expect(result.lead).toBeNull();
    expect(result.supporting).toHaveLength(16);
  });
});
