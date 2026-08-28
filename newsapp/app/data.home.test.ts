import { describe, expect, it } from "vitest";
import { isHomeBundle } from "./data";

const bundle = (status = "cc", display_home = true) => ({
  version: 1,
  generated_at: "2026-08-28T00:00:00Z",
  eligibility: "published_recent_analyzed_and_image_rights_cleared",
  window_days: 30,
  stories: [],
  articles: [
    {
      analysis: { summary_bg: "Резюме" },
      image_rights: { status, display_home },
    },
  ],
});

describe("home bundle runtime contract", () => {
  it("accepts only the declared version and fail-closed article rights", () => {
    expect(isHomeBundle(bundle())).toBe(true);
    expect(isHomeBundle(bundle("unknown", true))).toBe(false);
    expect(isHomeBundle(bundle("blocked", true))).toBe(false);
    expect(isHomeBundle(bundle("cc", false))).toBe(false);
    expect(isHomeBundle({ ...bundle(), version: 2 })).toBe(false);
  });
});
