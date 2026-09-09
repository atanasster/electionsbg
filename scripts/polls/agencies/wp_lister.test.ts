import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetchText, resetFetchTextMock } from "./test_helpers";

afterEach(resetFetchTextMock);

describe("wpPostToPublication", () => {
  it("maps id, url, decoded title, date-only publishedAt, and html kind", async () => {
    const { wpPostToPublication } = await import("./wp_lister");
    const pub = wpPostToPublication({
      id: 212847,
      date: "2026-06-01T08:07:02",
      link: "https://rctrend.bg/project/212847/",
      title: { rendered: "България след 20 години" },
    });
    expect(pub).toEqual({
      id: 212847,
      url: "https://rctrend.bg/project/212847/",
      title: "България след 20 години",
      publishedAt: "2026-06-01",
      kind: "html",
      attachments: [],
    });
  });

  it("decodes the HTML entities WordPress emits in titles", async () => {
    const { wpPostToPublication } = await import("./wp_lister");
    const pub = wpPostToPublication({
      id: 1,
      date: "2026-01-01T00:00:00",
      link: "https://example.bg/1",
      title: { rendered: "A &#8211; B &amp; C&#8217;s &#8220;test&#8221;" },
    });
    expect(pub.title).toBe("A – B & C’s “test”");
  });

  it("keeps publishedAt null when the listing carries no date", async () => {
    const { wpPostToPublication } = await import("./wp_lister");
    const pub = wpPostToPublication({
      id: 1,
      date: "",
      link: "https://example.bg/1",
      title: { rendered: "x" },
    });
    expect(pub.publishedAt).toBeNull();
  });
});

describe("fetchWpJson", () => {
  it("parses a JSON response", async () => {
    mockFetchText({ example: JSON.stringify([{ id: 1 }]) });
    const { fetchWpJson } = await import("./wp_lister");
    const out = await fetchWpJson<{ id: number }[]>(
      "https://example.bg/wp-json/wp/v2/posts",
    );
    expect(out).toEqual([{ id: 1 }]);
  });

  it("throws, naming the URL, on a non-JSON response (a down site serving HTML)", async () => {
    mockFetchText({ example: "<!doctype html><title>Down</title>" });
    const { fetchWpJson } = await import("./wp_lister");
    await expect(
      fetchWpJson("https://example.bg/wp-json/wp/v2/posts"),
    ).rejects.toThrow(/example\.bg.*non-JSON|non-JSON.*example\.bg/i);
  });

  it("throws on an empty response", async () => {
    mockFetchText({ example: null });
    const { fetchWpJson } = await import("./wp_lister");
    await expect(
      fetchWpJson("https://example.bg/wp-json/wp/v2/posts"),
    ).rejects.toThrow(/empty response/);
  });
});

describe("resolveCategoryIds", () => {
  it("matches category names case-insensitively and returns only the matches", async () => {
    mockFetchText({
      categories: JSON.stringify([
        { id: 69, name: "Проекти 2026", count: 2 },
        { id: 58, name: "Прогнозни 2021", count: 1 },
        { id: 1, name: "Проекти", count: 2 },
      ]),
    });
    const { resolveCategoryIds } = await import("./wp_lister");
    const ids = await resolveCategoryIds("https://sovaharris.com", [
      "проекти 2026",
      "Прогнозни 2021",
      "Прогнозни 2026", // does not exist yet — must be silently dropped
    ]);
    expect(ids.sort()).toEqual([58, 69]);
  });

  it("returns an empty list rather than throwing when no name matches", async () => {
    mockFetchText({ categories: JSON.stringify([]) });
    const { resolveCategoryIds } = await import("./wp_lister");
    const ids = await resolveCategoryIds("https://sovaharris.com", [
      "Прогнозни 2099",
    ]);
    expect(ids).toEqual([]);
  });
});

describe("listWpPosts", () => {
  it("builds the collection query from postType/categories/limit/after/before", async () => {
    // Captures the ACTUAL URL fetchText was called with, so this exercises the
    // query-building — not just that a fixture happened to match a substring.
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> | undefined;
    vi.doMock("../../watch/fingerprint", async (orig) => ({
      ...(await orig<typeof import("../../watch/fingerprint")>()),
      fetchText: async (
        url: string,
        opts?: { headers?: Record<string, string> },
      ) => {
        capturedUrl = url;
        capturedHeaders = opts?.headers;
        return JSON.stringify([
          {
            id: 1,
            date: "2026-04-16T10:54:45",
            link: "https://rctrend.bg/project/1/",
            title: { rendered: "Електорални нагласи" },
          },
        ]);
      },
    }));
    const { listWpPosts } = await import("./wp_lister");
    const posts = await listWpPosts("https://rctrend.bg", {
      postType: "project",
      limit: 5,
      after: "2026-01-01",
      before: "2026-12-31",
    });
    expect(capturedUrl).toContain("https://rctrend.bg/wp-json/wp/v2/project?");
    expect(capturedUrl).toContain("per_page=5");
    expect(capturedUrl).toContain("after=2026-01-01T00%3A00%3A00");
    expect(capturedUrl).toContain("before=2026-12-31T23%3A59%3A59");
    // The module header names the reason: every one of these sites has
    // blocked the bare Node UA on at least one endpoint in this repo's other
    // ingests. A future edit that drops the `headers` option would pass every
    // other test here silently.
    expect(capturedHeaders?.["User-Agent"]).toMatch(/Mozilla/);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toEqual({
      id: 1,
      url: "https://rctrend.bg/project/1/",
      title: "Електорални нагласи",
      publishedAt: "2026-04-16",
      kind: "html",
      attachments: [],
    });
  });

  it("defaults to the posts post type and no category filter", async () => {
    mockFetchText({
      "wp-json/wp/v2/posts": JSON.stringify([]),
    });
    const { listWpPosts } = await import("./wp_lister");
    const posts = await listWpPosts("https://globalmetrics.eu");
    expect(posts).toEqual([]);
  });

  it("forwards multiple category ids as a comma-joined param", async () => {
    mockFetchText({
      // The mock matches on URL substring; asserting the categories value
      // reached the URL is what actually exercises the join, so the fixture
      // key includes it.
      "categories=98%2C114": JSON.stringify([]),
    });
    const { listWpPosts } = await import("./wp_lister");
    const posts = await listWpPosts("https://myara.bg", {
      categories: [98, 114],
    });
    expect(posts).toEqual([]);
  });
});

describe("isExitPollTitle / titleContainsAny", () => {
  it("isExitPollTitle matches the shared exit-poll vocabulary", async () => {
    const { isExitPollTitle } = await import("./wp_lister");
    expect(isExitPollTitle("Екзит пол от изборите")).toBe(true);
    expect(isExitPollTitle("Паралелно преброяване — балотаж")).toBe(true);
    expect(
      isExitPollTitle("Електорални нагласи спрямо предстоящите избори"),
    ).toBe(false);
  });

  it("titleContainsAny refuses an exit-poll title even when it matches the term list", async () => {
    const { titleContainsAny } = await import("./wp_lister");
    const rule = titleContainsAny(["избори", "партии"]);
    const pub = (title: string) => ({
      id: 1,
      url: "x",
      title,
      publishedAt: null,
      kind: "html" as const,
      attachments: [],
    });
    // Would otherwise match on the bare "избори" substring inside
    // "изборите" — the real Trend false positive this gate exists for.
    expect(
      rule(
        pub("Профил на избирателя (екзит пол от изборите за Народно събрание)"),
      ),
    ).toBe(false);
    expect(rule(pub("Електорални нагласи спрямо предстоящите избори"))).toBe(
      true,
    );
    expect(rule(pub("Употреба на наркотични вещества"))).toBe(false);
  });
});
