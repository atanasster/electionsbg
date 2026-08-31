import { describe, expect, it } from "vitest";
import { isHomeBundle } from "./data";

const bundle = (status = "cc", display_home = true) => ({
  version: 2,
  generated_at: "2026-08-28T00:00:00Z",
  eligibility: "published_recent_analyzed_with_cleared_images_only",
  window_days: 30,
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
    expect(isHomeBundle({ ...bundle(), version: 1 })).toBe(false);
  });
});
