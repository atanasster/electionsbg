import { describe, expect, it } from "vitest";
import type { Story } from "../data";
import { resolveRelatedStories } from "./relatedStories";

const story = (id: string, related: string[] = []): Story =>
  ({
    id,
    title_bg: id,
    title_en: null,
    summary_bg: null,
    summary_en: null,
    first_published: null,
    last_published: null,
    topics: [],
    related_story_ids: related,
    entities: {
      people: [],
      parties: [],
      institutions: [],
      companies: [],
      places: [],
    },
    aggregates: {
      article_count: 0,
      outlet_count: 0,
      by_leaning: {},
      by_russia_stance: {},
      by_party_tone: {},
      by_domain: {},
    },
    blindspot: null,
    members: [],
  }) as Story;

describe("related stories", () => {
  it("preserves editorial order, removes duplicates and ignores stale ids", () => {
    const current = story("current", ["b", "missing", "a", "b", "current"]);
    expect(
      resolveRelatedStories(current, [current, story("a"), story("b")]),
    ).toEqual([story("b"), story("a")]);
  });

  it("caps the sidebar to four links", () => {
    const related = ["a", "b", "c", "d", "e"];
    expect(
      resolveRelatedStories(
        story("current", related),
        related.map((id) => story(id)),
      ).map(({ id }) => id),
    ).toEqual(["a", "b", "c", "d"]);
  });

  it("shows reciprocal inbound relationships after explicit editorial links", () => {
    const current = story("current", ["outbound"]);
    const older = story("older", ["current"]);
    older.first_published = "2026-08-20T10:00:00Z";
    const newer = story("newer", ["current"]);
    newer.first_published = "2026-08-21T10:00:00Z";
    expect(
      resolveRelatedStories(current, [older, newer, story("outbound")]).map(
        ({ id }) => id,
      ),
    ).toEqual(["outbound", "newer", "older"]);
  });
});
