// Gallup is two-armed (decision 2, §6.1): the site lister and a Google News
// RSS press query, unioned into one fingerprint. The behaviour under test:
// a single arm's failure degrades to "reported from the other arm only,
// with the failed one carried forward from prior state" rather than failing
// the whole source — only BOTH arms failing throws.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Publication } from "../../polls/agencies/types";

const pub = (id: number, electoral: boolean, title?: string): Publication => ({
  id,
  url: `https://gallup-international.bg/${id}`,
  title: title ?? (electoral ? `electoral post ${id}` : `other ${id}`),
  publishedAt: "2026-07-01",
  kind: "html",
  attachments: [],
});

const isElectoral = (p: Publication) => p.title.startsWith("electoral");

const mockGallupLister = (listPublications: () => Promise<Publication[]>) =>
  vi.doMock("../../polls/agencies/gallup", () => ({
    gallup: { agencyId: "GIB", listPublications, isElectoral },
  }));

const mockPressQuery = (fn: () => Promise<unknown[]>) =>
  vi.doMock("../../polls/lib/google_news_rss", async (orig) => ({
    ...(await orig<typeof import("../../polls/lib/google_news_rss")>()),
    googleNewsRss: fn,
  }));

const mockReadState = (state: unknown) =>
  vi.doMock("../state", () => ({ readState: () => state }));

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("../../polls/agencies/gallup");
  vi.doUnmock("../../polls/lib/google_news_rss");
  vi.doUnmock("../../polls/lib/agencies");
  vi.doUnmock("../state");
});

const pressItem = (
  title: string,
  pubDate: string,
  guid: string,
  sourceName = "БТВ",
) => ({
  title,
  link: "https://news.google.com/rss/articles/x",
  guid,
  pubDate,
  sourceUrl: null,
  sourceName,
});

describe("polls_gallup watch source", () => {
  it("is registered as two-armed, daily, weekly-publishing", async () => {
    mockGallupLister(async () => []);
    mockPressQuery(async () => []);
    mockReadState(null);
    const { pollsGallup } = await import("./polls_gallup");
    expect(pollsGallup.id).toBe("polls_gallup");
    expect(pollsGallup.label).toBe("Polls — Галъп (site + press)");
    expect(pollsGallup.cadence).toBe("daily");
    expect(pollsGallup.publishes).toBe("weekly");
  });

  it("unions both arms when both succeed", async () => {
    mockGallupLister(async () => [pub(10, true)]);
    mockPressQuery(async () => [
      pressItem("Галъп: избори", "Wed, 01 Jul 2026 08:00:00 GMT", "g1"),
    ]);
    mockReadState(null);
    const { pollsGallup } = await import("./polls_gallup");
    const fp = await pollsGallup.fingerprint();
    expect(fp.value).toBe("10:g1");
    expect(fp.detail).toContain("site — +1 electoral publication(s)");
    expect(fp.detail).toContain("press: +1 press item(s)");
    expect(fp.meta).toEqual({
      site: {
        newestId: 10,
        items: [
          {
            id: 10,
            url: "https://gallup-international.bg/10",
            title: "electoral post 10",
            publishedAt: "2026-07-01",
          },
        ],
      },
      press: {
        latestMs: Date.parse("Wed, 01 Jul 2026 08:00:00 GMT"),
        latestGuid: "g1",
        items: [
          {
            title: "Галъп: избори",
            link: "https://news.google.com/rss/articles/x",
            guid: "g1",
            pubDate: new Date(
              Date.parse("Wed, 01 Jul 2026 08:00:00 GMT"),
            ).toISOString(),
            sourceUrl: null,
            sourceName: "БТВ",
          },
        ],
      },
    });
  });

  it("degrades to the press arm alone when the site (TLS-broken) throws", async () => {
    mockGallupLister(async () => {
      throw new Error("TLS handshake failure");
    });
    mockPressQuery(async () => [
      pressItem("Галъп: избори", "Wed, 01 Jul 2026 08:00:00 GMT", "g1"),
    ]);
    mockReadState({
      fingerprint: "9:",
      detail: "seed",
      meta: { site: { newestId: 9, items: [] }, press: null },
      lastChecked: "2026-06-01T00:00:00.000Z",
    });
    const { pollsGallup } = await import("./polls_gallup");
    const fp = await pollsGallup.fingerprint();
    expect(fp.value).toBe("9:g1"); // site carries the PRIOR mark forward
    expect(fp.detail).toContain("site arm FAILED: TLS handshake failure");
    expect(fp.detail).toContain("press: +1 press item(s)");
    expect((fp.meta as { site: unknown }).site).toEqual({
      newestId: 9,
      items: [],
    }); // carried forward verbatim, not reset
    expect((fp.meta as { armErrors: { site: string } }).armErrors.site).toBe(
      "TLS handshake failure",
    );
  });

  it("degrades to the site arm alone when the press query throws", async () => {
    mockGallupLister(async () => [pub(10, true)]);
    mockPressQuery(async () => {
      throw new Error("rate limited");
    });
    mockReadState(null);
    const { pollsGallup } = await import("./polls_gallup");
    const fp = await pollsGallup.fingerprint();
    expect(fp.value).toBe("10:"); // no press guid known at all yet
    expect(fp.detail).toContain("site — +1 electoral publication(s)");
    expect(fp.detail).toContain("press arm FAILED: rate limited");
    expect((fp.meta as { press: unknown }).press).toBeNull();
  });

  it("does not spuriously report 'changed' when the press arm succeeds with no fresh coverage", async () => {
    // The FINDING-001 regression: a prior run had already established a
    // press mark (latestMs 1000, guid "gA"); today's query succeeds but
    // finds nothing new (the ordinary day-to-day case). The value must stay
    // byte-identical to the prior fingerprint, not drop the guid.
    mockGallupLister(async () => []);
    mockPressQuery(async () => []);
    mockReadState({
      fingerprint: "0:gA",
      detail: "prior run",
      meta: {
        site: null,
        press: { latestMs: 1000, latestGuid: "gA", items: [] },
      },
      lastChecked: "2026-09-01T00:00:00.000Z",
    });
    const { pollsGallup } = await import("./polls_gallup");
    const fp = await pollsGallup.fingerprint();
    expect(fp.value).toBe("0:gA"); // NOT "0:" — must equal the prior fingerprint
    expect(
      (fp.meta as { press: { latestGuid: string } }).press.latestGuid,
    ).toBe("gA");
  });

  it("does not crash the whole watch run if the GIB registry entry ever loses its pressQuery", async () => {
    // A module-level throw here would fail EVERY registered source's import
    // (scripts/watch/sources/index.ts loads them all statically) — the
    // check must live inside fingerprint() so a bad registry edit degrades
    // to this one source's own `error` report instead.
    vi.doMock("../../polls/lib/agencies", async (orig) => ({
      ...(await orig<typeof import("../../polls/lib/agencies")>()),
      agencyById: (id: string) =>
        id === "GIB" ? { pressQuery: null } : undefined,
    }));
    mockGallupLister(async () => []);
    mockReadState(null);
    // The IMPORT itself must succeed — a module-level throw here would take
    // down every OTHER registered source too, since index.ts imports all
    // ~100+ sources statically in one list.
    const mod = await import("./polls_gallup");
    expect(mod.pollsGallup).toBeDefined();
    await expect(mod.pollsGallup.fingerprint()).rejects.toThrow(
      /GIB registry entry carries no pressQuery/,
    );
  });

  it("throws only when BOTH arms fail", async () => {
    mockGallupLister(async () => {
      throw new Error("TLS handshake failure");
    });
    mockPressQuery(async () => {
      throw new Error("rate limited");
    });
    mockReadState(null);
    const { pollsGallup } = await import("./polls_gallup");
    await expect(pollsGallup.fingerprint()).rejects.toThrow(
      /both arms failed.*TLS handshake failure.*rate limited/s,
    );
  });
});
