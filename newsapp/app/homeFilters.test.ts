import { describe, expect, it } from "vitest";
import type { Story } from "./data";
import {
  defaultHomeDays,
  filterHomeStories,
  homeCategoryCounts,
  normalizeHomeSearch,
  storyWithinDays,
} from "./homeFilters";

const NOW = Date.parse("2026-08-28T12:00:00Z");
const story = (
  id: string,
  published: string | null,
  category = "society",
  title = id,
): Story =>
  ({
    id,
    title_bg: title,
    title_en: null,
    summary_bg: "Кратко резюме",
    last_published: published,
    topics: [{ category, subcategory: null, primary: true }],
  }) as Story;

describe("home filters", () => {
  it("uses finite inclusive windows and rejects future or invalid dates", () => {
    expect(storyWithinDays("2026-08-27T12:00:00Z", 1, NOW)).toBe(true);
    expect(storyWithinDays("2026-08-27T11:59:59Z", 1, NOW)).toBe(false);
    expect(storyWithinDays("2026-08-29T12:00:00Z", 30, NOW)).toBe(false);
    expect(storyWithinDays("not-a-date", 30, NOW)).toBe(false);
    expect(storyWithinDays(null, 30, NOW)).toBe(false);
    expect(storyWithinDays("2026-08-28T12:00:00Z", 0, NOW)).toBe(false);
    expect(storyWithinDays("2026/08/28 12:00:00", 30, NOW)).toBe(false);
    expect(storyWithinDays("2026-08-28T15:00:00+03:00", 7, NOW)).toBe(true);
  });

  it("defaults to the shortest window with enough eligible stories", () => {
    const recent = Array.from({ length: 6 }, (_, index) =>
      story(`recent-${index}`, "2026-08-28T11:00:00Z"),
    );
    expect(defaultHomeDays(recent, NOW)).toBe(1);

    recent.splice(0, 2);
    const weekly = [
      ...recent,
      story("weekly-1", "2026-08-25T11:00:00Z"),
      story("weekly-2", "2026-08-24T11:00:00Z"),
    ];
    expect(defaultHomeDays(weekly, NOW)).toBe(7);
    expect(defaultHomeDays(weekly.slice(0, 5), NOW)).toBe(7);
    expect(defaultHomeDays([], NOW)).toBe(7);
  });

  it("normalizes Unicode and whitespace and searches the English summary", () => {
    expect(normalizeHomeSearch("  ВАЖНА\u00a0  тема  ")).toBe("важна тема");
    const item = story("one", "2026-08-28T09:00:00Z");
    item.summary_en = "Cafe\u0301 reform";
    expect(
      filterHomeStories([item], {
        category: "all",
        days: 30,
        query: "CAFÉ   REFORM",
        now: NOW,
      }),
    ).toEqual([item]);
  });

  it("combines topic, time and Bulgarian case-insensitive search", () => {
    const stories = [
      story("one", "2026-08-28T09:00:00Z", "society", "ВАЖНА История"),
      story("two", "2026-08-28T09:00:00Z", "economy", "Друга"),
      story("old", "2026-07-01T09:00:00Z", "society", "Важна стара"),
    ];
    expect(
      filterHomeStories(stories, {
        category: "society",
        days: 7,
        query: "важна",
        now: NOW,
      }).map((item) => item.id),
    ).toEqual(["one"]);
  });

  it("ages results when the captured clock advances and preserves input order", () => {
    const boundary = story("boundary", "2026-08-27T12:00:00Z");
    const fresh = story("fresh", "2026-08-28T11:00:00Z");
    const state = { category: "all", days: 1, query: "" };
    expect(
      filterHomeStories([boundary, fresh], { ...state, now: NOW }).map(
        (item) => item.id,
      ),
    ).toEqual(["boundary", "fresh"]);
    expect(
      filterHomeStories([boundary, fresh], { ...state, now: NOW + 60_000 }).map(
        (item) => item.id,
      ),
    ).toEqual(["fresh"]);
  });

  it("counts each story once per category even with two topic refs", () => {
    const item = story("one", "2026-08-28T09:00:00Z");
    item.topics.push({
      category: "society",
      subcategory: "people",
      primary: false,
    });
    expect(homeCategoryCounts([item]).get("society")).toBe(1);
  });
});
