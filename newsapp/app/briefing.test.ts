import { beforeEach, describe, expect, it } from "vitest";
import {
  buildBriefingSections,
  DEFAULT_BRIEFING_PREFERENCES,
  MAX_FOLLOWED_TOPICS,
  NEWS_BRIEFING_STORAGE_KEY,
  readBriefingPreferences,
  sanitizeBriefingPreferences,
  storiesSinceBriefing,
  writeBriefingPreferences,
} from "./briefing";
import type { HomeHierarchy, HomeStoryItem } from "./homeHierarchy";

const item = (
  id: string,
  topic: string,
  kind: HomeStoryItem["kind"],
): HomeStoryItem => ({
  story: {
    id,
    title_bg: id,
    title_en: null,
    summary_bg: "Резюме",
    summary_en: null,
    last_published: `2026-09-01T0${id.length}:00:00Z`,
    topics: [{ category: topic, subcategory: null, primary: true }],
    aggregates: {
      article_count: kind === "comparison" ? 2 : 1,
      outlet_count: kind === "comparison" ? 2 : 1,
      by_leaning: {},
      by_russia_stance: {},
      by_party_tone: {},
      by_domain: {},
    },
  },
  imageArticle: null,
  kind,
});

beforeEach(() => localStorage.clear());

describe("private briefing preferences", () => {
  it("fails closed and bounds followed topic ids", () => {
    const topics = Array.from({ length: 12 }, (_, index) => `topic-${index}`);
    expect(
      sanitizeBriefingPreferences({
        cadence: "weekly",
        density: "compact",
        followedTopics: [...topics, "topic-1", "private value with spaces"],
        lastCompletedAt: "not-a-date",
        profile: { email: "private@example.com" },
      }),
    ).toEqual({
      version: 1,
      cadence: "weekly",
      density: "compact",
      followedTopics: topics.slice(0, MAX_FOLLOWED_TOPICS),
      lastCompletedAt: null,
      completedStoryIds: [],
    });
  });

  it("round-trips only the sanitized local preference contract", () => {
    writeBriefingPreferences({
      ...DEFAULT_BRIEFING_PREFERENCES,
      followedTopics: ["politics"],
    });
    expect(readBriefingPreferences().followedTopics).toEqual(["politics"]);
    expect(localStorage.getItem(NEWS_BRIEFING_STORAGE_KEY)).not.toContain(
      "email",
    );
  });
});

describe("finite briefing composition", () => {
  const hierarchy: HomeHierarchy = {
    lead: null,
    supporting: [
      item("a", "politics", "comparison"),
      item("bb", "economy", "analyzed_article"),
      item("ccc", "politics", "analyzed_article"),
      item("dddd", "politics", "comparison"),
      item("eeeee", "world", "comparison"),
    ],
  };

  it("groups followed-topic stories and retains a visible outside sample", () => {
    const result = buildBriefingSections(hierarchy, ["politics"]);
    expect(result.update.map((entry) => entry.story.id)).toEqual([
      "a",
      "ccc",
      "dddd",
    ]);
    expect(result.outsideInterests.map((entry) => entry.story.id)).toEqual([
      "bb",
      "eeeee",
    ]);
    expect(result.visibleCount).toBe(5);
  });

  it("keeps every default story in one finite section", () => {
    const result = buildBriefingSections(hierarchy, []);
    const ids = [
      ...result.update,
      ...result.moreAnalyzed,
      ...result.perspectives,
    ].map((entry) => entry.story.id);
    expect(ids).toEqual(["a", "bb", "ccc", "dddd", "eeeee"]);
    expect(new Set(ids).size).toBe(hierarchy.supporting.length);
    expect(result.outsideInterests).toEqual([]);
  });

  it("uses completed story ids so delayed additions still count as new", () => {
    const stories = hierarchy.supporting.map((entry) => entry.story);
    expect(storiesSinceBriefing(stories, ["a", "bb"])).toBe(3);
    expect(storiesSinceBriefing(stories, [])).toBeNull();
    expect(storiesSinceBriefing([{ id: stories[0].id }], ["older-id"])).toBe(1);
  });

  it("removes completed cards from Update me without hiding them", () => {
    const completedIds = hierarchy.supporting.map((entry) => entry.story.id);
    const result = buildBriefingSections(hierarchy, [], completedIds);
    expect(result.update).toEqual([]);
    expect([...result.moreAnalyzed, ...result.perspectives]).toHaveLength(
      hierarchy.supporting.length,
    );
    expect(result.currentStoryIds).toEqual(completedIds);
  });
});
