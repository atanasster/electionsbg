import { describe, expect, it } from "vitest";
import { isHomeBundle } from "./data";

const bundle = (status = "cc", display_home = true) => ({
  version: 3,
  generated_at: "2026-08-28T00:00:00Z",
  eligibility: "published_recent_analyzed_with_cleared_images_only",
  window_days: 30,
  event_dedupe: "conservative_title_entity_v1",
  merge_proposals: [],
  home_health: {
    version: 1,
    default_days: 1,
    thresholds: {
      stories_for_24h_default: 6,
      maximum_implicit_days: 7,
      newest_story_max_hours: 24,
    },
    counts: {
      recent_raw: 0,
      recent_analyzed: 0,
      recent_story_linked: 0,
      recent_image_cleared: 0,
      selected_unique_events: 0,
      selected_within_24h: 0,
      default_visible: 0,
      default_comparisons: 0,
      default_image_eligible: 0,
      merge_proposals: 0,
    },
    default_age_hours: {
      newest_hours: null,
      median_hours: null,
      oldest_hours: null,
    },
    default_payload: [],
    checks: {
      selected_payload_not_empty: false,
      has_story_within_24h: false,
      default_window_at_most_7_days: true,
      default_payload_not_empty: false,
      selected_story_ids_unique: true,
      default_story_ids_unique: true,
      default_oldest_within_window: false,
      no_future_story_timestamps: true,
      every_default_story_has_analyzed_article: true,
    },
    ready: false,
  },
  stories: [],
  articles: [
    {
      analysis: { summary_bg: "Резюме" },
      image: display_home ? "https://upload.wikimedia.org/photo.jpg" : null,
      image_rights: { status, display_home },
    },
  ],
});

describe("home bundle runtime contract", () => {
  it("accepts analyzed text-first rows and fails closed for display images", () => {
    expect(isHomeBundle(bundle())).toBe(true);
    expect(isHomeBundle(bundle("unknown", true))).toBe(false);
    expect(isHomeBundle(bundle("blocked", true))).toBe(false);
    expect(isHomeBundle(bundle("pirated", true))).toBe(false);
    expect(isHomeBundle(bundle("cc", false))).toBe(true);
    expect(
      isHomeBundle({
        ...bundle("cc", false),
        articles: [
          {
            analysis: { summary_bg: "Резюме" },
            image: "https://publisher.example/photo.jpg",
          },
        ],
      }),
    ).toBe(false);
    expect(isHomeBundle({ ...bundle(), version: 2 })).toBe(false);
  });

  it.each([
    null,
    { confidence: "low" },
    {
      keeper_story_id: "s1",
      matched_story_id: "s1",
      candidate_story_id: "s2",
      confidence: "high",
      shared_title_tokens: [],
      shared_entities: [],
      shared_places: [],
      title_jaccard: 0.8,
      published_gap_hours: 2,
      topic: ["politics"],
    },
  ])("rejects a malformed merge proposal: %o", (proposal) => {
    expect(isHomeBundle({ ...bundle(), merge_proposals: [proposal] })).toBe(
      false,
    );
  });

  it("accepts a complete auditable merge proposal", () => {
    const proposal = {
      keeper_story_id: "s1",
      matched_story_id: "s1",
      candidate_story_id: "s2",
      confidence: "high",
      shared_title_tokens: ["андрей", "гюров"],
      shared_entities: ["Андрей Гюров"],
      shared_places: [],
      title_jaccard: 0.75,
      published_gap_hours: 1.5,
      topic: ["elections-parliamentary", "campaign"],
    };
    expect(isHomeBundle({ ...bundle(), merge_proposals: [proposal] })).toBe(
      true,
    );
  });

  it.each([
    { default_age_hours: undefined },
    { counts: [] },
    { checks: [] },
    { thresholds: { maximum_implicit_days: 7, newest_story_max_hours: 24 } },
    { ready: true },
  ])("rejects malformed home health: %o", (over) => {
    expect(
      isHomeBundle({
        ...bundle(),
        home_health: { ...bundle().home_health, ...over },
      }),
    ).toBe(false);
  });
});
