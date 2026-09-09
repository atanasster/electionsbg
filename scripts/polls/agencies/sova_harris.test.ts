import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetchText, resetFetchTextMock } from "./test_helpers";

afterEach(resetFetchTextMock);

// Derived from the current year, not a fixed "2026" — the production code
// resolves the SAME-year category, and this repo runs past 2026, so a
// hardcoded year would silently stop matching the real lookup after this run.
const THIS_YEAR = new Date().getUTCFullYear();
const RESOLVED_CATEGORY_ID = 69;
const CATEGORIES = [
  { id: RESOLVED_CATEGORY_ID, name: `Проекти ${THIS_YEAR}`, count: 2 },
  { id: 60, name: "Прогнозни 2018", count: 0 },
  // The current year's "Прогнозни" category has not been created yet — must
  // not abort the listing, just contribute nothing.
];

const POSTS_2026 = [
  {
    id: 4142,
    date: "2026-04-09T09:55:30",
    link: "https://sovaharris.com/politicheski-naglasi-v-bulgariya/",
    title: { rendered: "Политически нагласи в България" },
  },
  {
    id: 4100,
    date: "2026-01-05T00:00:00",
    link: "https://sovaharris.com/izbori-za-prezident-i-vitseprezident-balotazh/",
    title: {
      rendered:
        "Избори за Президент и вицепрезидент на Република България – балотаж",
    },
  },
];

describe("sovaHarris lister", () => {
  it("resolves this-year and last-year category ids, then lists within them", async () => {
    let categoriesUrl = "";
    let postsUrl = "";
    vi.doMock("../../watch/fingerprint", async (orig) => ({
      ...(await orig<typeof import("../../watch/fingerprint")>()),
      fetchText: async (url: string) => {
        // The ENDPOINT path, not a bare "categories" substring — the posts
        // request itself carries `?categories=69` as a filter param and would
        // otherwise false-match this check.
        if (url.includes("wp-json/wp/v2/categories")) {
          categoriesUrl = url;
          return JSON.stringify(CATEGORIES);
        }
        postsUrl = url;
        return JSON.stringify(POSTS_2026);
      },
    }));
    const { listPublications } = await import("./sova_harris");
    const pubs = await listPublications();
    expect(categoriesUrl).toContain("sovaharris.com/wp-json/wp/v2/categories");
    // Only the id that actually resolved (69) reaches the posts query.
    expect(postsUrl).toContain(`categories=${RESOLVED_CATEGORY_ID}`);
    expect(pubs).toHaveLength(2);
  });

  it("returns nothing rather than throwing when no category resolves", async () => {
    mockFetchText({ categories: JSON.stringify([]) });
    const { listPublications } = await import("./sova_harris");
    const pubs = await listPublications();
    expect(pubs).toEqual([]);
  });

  it("excludes exit polls even though they mention 'президент'", async () => {
    const { isElectoral } = await import("./sova_harris");
    const exitPoll = {
      id: 1,
      url: "x",
      title: "Резултати от екзит пол — избори за президент, ноември 2026",
      publishedAt: null,
      kind: "html" as const,
      attachments: [],
    };
    const parallelCount = {
      id: 2,
      url: "x",
      title: "Паралелно преброяване — президентски избори 2026",
      publishedAt: null,
      kind: "html" as const,
      attachments: [],
    };
    expect(isElectoral(exitPoll)).toBe(false);
    expect(isElectoral(parallelCount)).toBe(false);
  });

  it("classifies an ordinary pre-election poll as electoral", async () => {
    const { isElectoral } = await import("./sova_harris");
    const poll = {
      id: 2,
      url: "x",
      title: "Политически нагласи в България",
      publishedAt: null,
      kind: "html" as const,
      attachments: [],
    };
    expect(isElectoral(poll)).toBe(true);
  });

  it("is registered under the SH agency id", async () => {
    const { sovaHarris } = await import("./sova_harris");
    expect(sovaHarris.agencyId).toBe("SH");
  });
});
