import { describe, expect, it } from "vitest";
import { isHomeBundle } from "./data";

const bundle = (status = "cc", display_home = true) => ({
  version: 3,
  generated_at: "2026-08-28T00:00:00Z",
  eligibility: "published_recent_analyzed_with_cleared_images_only",
  window_days: 30,
  event_dedupe: "conservative_title_entity_v1",
  merge_proposals: [],
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
});
