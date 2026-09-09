// Smoke tests for the six thin single-arm watcher files (Trend, Alpha
// Research, Market Links, Sova Harris, Мяра, Global Metrics) — each wires a
// REAL lister into `makeAgencyPollsWatcher` with no logic of its own.
//
// The monotonic-fingerprint logic itself is tested once, thoroughly, against
// a stub lister in scripts/polls/lib/watcher.test.ts; each real lister's own
// parsing is tested once, thoroughly, in its own scripts/polls/agencies/*
// test file. What these tests exist to catch is a copy-paste mistake across
// six near-identical files — the wrong id, the wrong label, or (the one that
// would matter most) wiring agency A's watcher to agency B's lister, which
// nothing here would fail loudly on otherwise: both listers return the SAME
// `AgencyLister` shape, so a swapped import still type-checks.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../fingerprint", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../fingerprint")>()),
  fetchText: vi.fn(),
}));
vi.mock("../state", () => ({ readState: vi.fn() }));

import { fetchText } from "../fingerprint";
import { readState } from "../state";
import { pollsTrend } from "./polls_trend";
import { pollsAlphaResearch } from "./polls_alpha_research";
import { pollsMarketLinks } from "./polls_market_links";
import { pollsSovaHarris } from "./polls_sova_harris";
import { pollsMyara } from "./polls_myara";
import { pollsGlobalMetrics } from "./polls_global_metrics";

const mockedFetchText = vi.mocked(fetchText);
const mockedReadState = vi.mocked(readState);

beforeEach(() => {
  vi.resetAllMocks();
  mockedReadState.mockReturnValue(null);
});

const EMPTY_WP_POSTS = "[]";
const EMPTY_WP_CATEGORIES = "[]";
const EMPTY_CHEERIO_HTML = `<html><body><div id="content"></div></body></html>`;

describe.each([
  {
    name: "Trend",
    source: pollsTrend,
    id: "polls_trend",
    host: "rctrend.bg",
    body: EMPTY_WP_POSTS,
  },
  {
    name: "Alpha Research",
    source: pollsAlphaResearch,
    id: "polls_alpha_research",
    host: "alpharesearch.bg",
    body: EMPTY_CHEERIO_HTML,
  },
  {
    name: "Market Links",
    source: pollsMarketLinks,
    id: "polls_market_links",
    host: "marketlinks.bg",
    body: EMPTY_CHEERIO_HTML,
  },
  {
    name: "Sova Harris",
    source: pollsSovaHarris,
    id: "polls_sova_harris",
    host: "sovaharris.com",
    body: EMPTY_WP_CATEGORIES, // categories resolve to [] — listWpPosts is never reached
  },
  {
    name: "Мяра",
    source: pollsMyara,
    id: "polls_myara",
    host: "myara.bg",
    body: EMPTY_WP_POSTS,
  },
  {
    name: "Global Metrics",
    source: pollsGlobalMetrics,
    id: "polls_global_metrics",
    host: "globalmetrics.eu",
    body: EMPTY_WP_POSTS,
  },
])("polls_$name watch source", ({ source, id, host, body }) => {
  it(`is registered as "${id}", daily, weekly-publishing, over its own host`, () => {
    expect(source.id).toBe(id);
    expect(source.cadence).toBe("daily");
    expect(source.publishes).toBe("weekly");
    expect(source.url).toContain(host);
    expect(source.label.startsWith("Polls — ")).toBe(true);
  });

  it("delegates its fingerprint fetch to its OWN agency's host", async () => {
    mockedFetchText.mockResolvedValue(body);
    await source.fingerprint();
    expect(mockedFetchText).toHaveBeenCalled();
    for (const [url] of mockedFetchText.mock.calls)
      expect(url as string).toContain(host);
  });

  it("reports the backlog-free state cleanly on an empty listing", async () => {
    mockedFetchText.mockResolvedValue(body);
    const fp = await source.fingerprint();
    expect(fp.value).toBe("0");
    expect(fp.meta).toEqual({ newestId: 0, items: [] });
  });
});
