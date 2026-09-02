import { describe, expect, it } from "vitest";
import { isHomeBundle } from "./data";

const bundle = (
  status = "cc",
  display_home = true,
  rights: Record<string, unknown> = {},
) => ({
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
      domain: "ex.bg",
      image: display_home ? "https://upload.wikimedia.org/photo.jpg" : null,
      image_rights: { status, display_home, ...rights },
    },
  ],
});

describe("home bundle runtime contract", () => {
  it("rejects a provenance role that claims more than its evidence", () => {
    // ⚠️ Defence in depth for the ONE role that names somebody else. The build
    // refuses a `source_photo` without an article URL on the outlet's own
    // domain, so this can only fire on a hand-edited or truncated bundle —
    // which is exactly when it matters, because the caption it feeds says
    // „От публикацията на X".
    expect(
      isHomeBundle(bundle("cc", true, { role: "illustration" })),
      "a stated illustration is fine",
    ).toBe(true);
    expect(
      isHomeBundle(bundle("cc", true, { role: null })),
      "unstated is fine — it renders the neutral label",
    ).toBe(true);
    expect(
      isHomeBundle(bundle("cc", true, { role: "source_photo" })),
      "source_photo with no evidence must be refused",
    ).toBe(false);
    expect(
      isHomeBundle(
        bundle("cc", true, {
          role: "source_photo",
          source_article_url: "https://ex.bg/a/1",
        }),
      ),
    ).toBe(true);
    // An unrecognised role is refused rather than ignored: rendering it as the
    // neutral label would make a typo indistinguishable from a decision.
    expect(isHomeBundle(bundle("cc", true, { role: "photo" }))).toBe(false);
    expect(isHomeBundle(bundle("cc", true, { role: "official_image" }))).toBe(
      true,
    );
  });

  it("does not accept provenance the build refuses", () => {
    // ⚠️ A guard that is merely WEAKER than the build is not defence in depth
    // — it is a second, more permissive contract deciding what the page
    // renders. Each case below fails `build_app_data.py`; each must fail here.
    const cases: [string, Record<string, unknown>][] = [
      [
        "evidence on somebody else's domain",
        { role: "source_photo", source_article_url: "https://other.example/a" },
      ],
      [
        "a URL two parsers disagree about",
        {
          role: "source_photo",
          source_article_url: "https://evil.example\\@ex.bg/a",
        },
      ],
      ["a focal point out of range", { crop_allowed: true, focal_x: 1.4 }],
      // A focal point steers a crop, so an unreviewed crop decision must not
      // be settled by its presence.
      ["a focal point with no crop permission", { focal_y: 0.5 }],
      [
        "a focal point against a refused crop",
        { crop_allowed: false, focal_x: 0.5 },
      ],
    ];
    for (const [why, rights] of cases)
      expect(isHomeBundle(bundle("cc", true, rights)), why).toBe(false);

    // The same shapes, correctly stated, pass.
    expect(
      isHomeBundle(
        bundle("cc", true, {
          role: "source_photo",
          source_article_url: "https://www.ex.bg/a/1",
          crop_allowed: true,
          focal_x: 0.4,
          focal_y: 0.6,
        }),
      ),
    ).toBe(true);
  });

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
            domain: "ex.bg",
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
