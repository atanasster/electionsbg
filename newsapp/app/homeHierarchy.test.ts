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
    const lead = story("lead", 4, "2026-08-26T09:00:00Z");
    const earlier = story("earlier", 3, "2026-08-28T10:00:00+03:00");
    const later = story("later", 2, "2026-08-28T08:00:00Z");
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
});
