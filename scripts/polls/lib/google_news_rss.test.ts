import { afterEach, describe, expect, it, vi } from "vitest";

const mockFetchText = (byUrl: string | null) =>
  vi.doMock("../../watch/fingerprint", async (orig) => ({
    ...(await orig<typeof import("../../watch/fingerprint")>()),
    fetchText: async () => byUrl,
  }));

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("../../watch/fingerprint");
});

const rssFeed = (items: string[]): string =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>junk</title>` +
  items.join("") +
  `</channel></rss>`;

const rssItem = (opts: {
  title: string;
  link?: string;
  guid?: string;
  pubDate: string;
  sourceUrl?: string;
  sourceName?: string;
}): string =>
  `<item>` +
  `<title>${opts.title}</title>` +
  `<link>${opts.link ?? "https://news.google.com/rss/articles/tok1"}</link>` +
  (opts.guid ? `<guid isPermaLink="false">${opts.guid}</guid>` : "") +
  `<pubDate>${opts.pubDate}</pubDate>` +
  (opts.sourceUrl
    ? `<source url="${opts.sourceUrl}">${opts.sourceName ?? ""}</source>`
    : "") +
  `</item>`;

describe("googleNewsRss", () => {
  it("parses title, link, guid, pubDate and the outlet source", async () => {
    mockFetchText(
      rssFeed([
        rssItem({
          title: "Медиана: 30% &amp; 40% &#8211; проучване",
          guid: "abc123",
          pubDate: "Wed, 09 Sep 2026 06:00:00 GMT",
          sourceUrl: "https://btvnovinite.bg",
          sourceName: "БТВ Новините",
        }),
      ]),
    );
    const { googleNewsRss } = await import("./google_news_rss");
    const items = await googleNewsRss('"Медиана" проучване');
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      title: "Медиана: 30% & 40% – проучване",
      link: "https://news.google.com/rss/articles/tok1",
      guid: "abc123",
      pubDate: "Wed, 09 Sep 2026 06:00:00 GMT",
      sourceUrl: "https://btvnovinite.bg",
      sourceName: "БТВ Новините",
    });
  });

  it("falls back to the link as the guid when the item carries none", async () => {
    mockFetchText(
      rssFeed([
        rssItem({
          title: "Заглавие",
          link: "https://news.google.com/rss/articles/tok2",
          pubDate: "Wed, 09 Sep 2026 06:00:00 GMT",
        }),
      ]),
    );
    const { googleNewsRss } = await import("./google_news_rss");
    const items = await googleNewsRss("q");
    expect(items[0].guid).toBe("https://news.google.com/rss/articles/tok2");
    expect(items[0].sourceUrl).toBeNull();
  });

  it("decodes entities in link/guid, not just title/source", async () => {
    mockFetchText(
      rssFeed([
        rssItem({
          title: "Заглавие",
          link: "https://news.google.com/rss/articles/tok?a=1&amp;b=2",
          guid: "g&amp;1",
          pubDate: "Wed, 09 Sep 2026 06:00:00 GMT",
        }),
      ]),
    );
    const { googleNewsRss } = await import("./google_news_rss");
    const items = await googleNewsRss("q");
    expect(items[0].link).toBe(
      "https://news.google.com/rss/articles/tok?a=1&b=2",
    );
    expect(items[0].guid).toBe("g&1");
  });

  it("returns an empty array for a feed with no items — a real answer, not a failure", async () => {
    mockFetchText(rssFeed([]));
    const { googleNewsRss } = await import("./google_news_rss");
    await expect(googleNewsRss("q")).resolves.toEqual([]);
  });

  it("throws on a null response rather than returning []", async () => {
    mockFetchText(null);
    const { googleNewsRss } = await import("./google_news_rss");
    await expect(googleNewsRss("q")).rejects.toThrow(/empty response/);
  });
});

describe("isElectoralHeadline", () => {
  it("matches the shared electoral-title vocabulary", async () => {
    const { isElectoralHeadline } = await import("./google_news_rss");
    expect(isElectoralHeadline("Медиана: партии на финала")).toBe(true);
    expect(isElectoralHeadline("Проучване на нагласите преди изборите")).toBe(
      true,
    );
    expect(isElectoralHeadline("Президентската надпревара се нажежава")).toBe(
      true,
    );
    expect(isElectoralHeadline("Времето утре ще бъде слънчево")).toBe(false);
  });
});

describe("computePressArm", () => {
  const item = (
    title: string,
    pubDate: string,
    guid = "g",
    sourceName: string | null = null,
  ) => ({
    title,
    link: "https://news.google.com/rss/articles/x",
    guid,
    pubDate,
    sourceUrl: null,
    sourceName,
  });

  it("on the first run, reports every electoral item as new, newest first", async () => {
    const { computePressArm } = await import("./google_news_rss");
    const raw = [
      item("Времето утре", "Wed, 01 Jul 2026 06:00:00 GMT", "irrelevant"),
      item(
        "Медиана: избори — проучване",
        "Wed, 01 Jul 2026 08:00:00 GMT",
        "g1",
        "БТВ",
      ),
      item("Медиана: партии", "Wed, 01 Jul 2026 07:00:00 GMT", "g2"),
    ];
    const arm = computePressArm(raw, null, null, "Медиана");
    expect(arm.items.map((i) => i.guid)).toEqual(["g1", "g2"]); // electoral only, newest first
    expect(arm.latestGuid).toBe("g1");
    expect(arm.detail).toContain("+2 press item(s)");
    expect(arm.detail).toContain("БТВ");
  });

  it("reports only items newer than the prior mark", async () => {
    const { computePressArm } = await import("./google_news_rss");
    const prevMs = Date.parse("Wed, 01 Jul 2026 07:00:00 GMT");
    const raw = [
      item("Медиана: партии", "Wed, 01 Jul 2026 07:00:00 GMT", "g2"),
      item("Медиана: избори", "Wed, 02 Jul 2026 09:00:00 GMT", "g3"),
    ];
    const arm = computePressArm(raw, prevMs, "g2", "Медиана");
    expect(arm.items.map((i) => i.guid)).toEqual(["g3"]);
    expect(arm.latestMs).toBe(Date.parse("Wed, 02 Jul 2026 09:00:00 GMT"));
    expect(arm.latestGuid).toBe("g3");
  });

  it("NEVER regresses the mark when the feed rolls the newest item off — latestMs AND latestGuid", async () => {
    const prevMs = Date.parse("Wed, 02 Jul 2026 09:00:00 GMT");
    const { computePressArm } = await import("./google_news_rss");
    const raw = [
      item("Медиана: партии", "Wed, 01 Jul 2026 07:00:00 GMT", "g2"),
    ];
    const arm = computePressArm(raw, prevMs, "g-established", "Медиана");
    expect(arm.latestMs).toBe(prevMs);
    // The guid must be carried forward exactly like latestMs — resetting it
    // to "" here while latestMs stays non-zero is what made the fingerprint
    // flip on an ordinary "nothing new today" run (the bug this test locks
    // in against).
    expect(arm.latestGuid).toBe("g-established");
    expect(arm.items).toEqual([]);
    expect(arm.detail).toBe("Медиана: no new press coverage");
  });

  it("reports no electoral coverage when nothing in the feed matches the title rule", async () => {
    const { computePressArm } = await import("./google_news_rss");
    const raw = [item("Времето утре", "Wed, 01 Jul 2026 07:00:00 GMT")];
    const arm = computePressArm(raw, null, null, "АФИС");
    expect(arm.latestMs).toBe(0);
    expect(arm.latestGuid).toBe("");
    expect(arm.detail).toBe("АФИС: no electoral coverage found");
  });

  it("drops items whose pubDate cannot be parsed", async () => {
    const { computePressArm } = await import("./google_news_rss");
    const raw = [item("Медиана: избори", "not-a-date", "g1")];
    const arm = computePressArm(raw, null, null, "Медиана");
    expect(arm.items).toEqual([]);
    expect(arm.latestMs).toBe(0);
  });
});
